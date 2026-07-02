/**
 * POST /api/notifications/emit — client-driven notification emit.
 *
 * The site's IntentChatCard fires this when an intent reaches a
 * terminal state (executed / failed / rejected / expired) so the
 * sidebar badge on Workflows updates without a page refresh. The
 * server rehydrates the wallet from the SIWS session, formats the
 * body copy, and writes a `notifications` row. Emission is
 * idempotent per (wallet, kind, ref_id) within a 60s window — a
 * duplicate fire from React strict mode or a resubmit does not
 * spam the ledger.
 *
 * This route is deliberately minimal: it does NOT accept a free
 * `body` field from the client — instead the payload carries just
 * enough shape (kind + amount/symbol/tx_hash) and the server picks
 * a canonical copy string. That way a hostile client cannot inject
 * arbitrary text into another user's notification feed.
 */

import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import { enforceWalletRateLimit } from '@/lib/payment/rate-limit';
import {
  insertNotification,
  type NotificationKind,
  type NotificationLevel,
} from '@/lib/payment/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const KNOWN_KINDS: ReadonlySet<NotificationKind> = new Set([
  'workflow_executed',
  'workflow_failed',
  'alert_triggered',
  'alert_resolved',
  'payment_due',
]);

const KNOWN_LEVELS: ReadonlySet<NotificationLevel> = new Set([
  'info',
  'success',
  'warn',
  'error',
]);

const SYMBOL_RE = /^[A-Z0-9]{1,16}$/;
const AMOUNT_RE = /^\d+(?:\.\d{1,18})?$/;
const REF_ID_RE = /^[A-Za-z0-9_-]{4,128}$/;
const TX_HASH_RE = /^[a-zA-Z0-9]{16,128}$/;
const URL_RE = /^https:\/\/[^\s"'<>]{4,300}$/;
const SHORT_ID_RE = /^[A-Za-z0-9…_-]{2,64}$/;

interface EmitBody {
  kind?: unknown;
  ref_id?: unknown;
  level?: unknown;
  symbol?: unknown;
  amount?: unknown;
  tx_hash?: unknown;
  explorer_url?: unknown;
  error?: unknown;
  short_id?: unknown;
}

/**
 * Compose the canonical, safe body string from validated pieces.
 * The server owns the string so a hostile client can't inject
 * markdown, links, or emoji into the ledger and, downstream, into
 * a future email/push notification.
 */
function composeBody(
  kind: NotificationKind,
  parts: {
    symbol: string;
    amount?: string;
    txShort?: string;
    error?: string;
  },
): string {
  switch (kind) {
    case 'workflow_executed':
      return parts.txShort
        ? `Transferred ${parts.amount ?? ''} ${parts.symbol} · tx ${parts.txShort}`.trim()
        : `Transferred ${parts.amount ?? ''} ${parts.symbol}`.trim();
    case 'workflow_failed':
      return parts.error
        ? `Transfer of ${parts.amount ?? ''} ${parts.symbol} failed — ${parts.error.slice(0, 200)}`
        : `Transfer of ${parts.amount ?? ''} ${parts.symbol} failed`;
    case 'alert_triggered':
      return `Alert triggered on ${parts.symbol}`;
    case 'alert_resolved':
      return `Alert resolved on ${parts.symbol}`;
    case 'payment_due':
      return `Scheduled payment ready: ${parts.amount ?? ''} ${parts.symbol}`.trim();
    default:
      return `${kind} · ${parts.symbol}`;
  }
}

export async function POST(req: Request) {
  const contentType = (req.headers.get('content-type') ?? '')
    .split(';')[0]
    ?.trim();
  if (contentType !== 'application/json') {
    return NextResponse.json(
      { ok: false, reason: 'invalid_content_type' },
      { status: 415, headers: NO_STORE },
    );
  }
  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401, headers: NO_STORE },
    );
  }
  const limited = enforceWalletRateLimit(session.wallet, 'notifications.emit');
  if (limited) return limited as unknown as NextResponse;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    );
  }
  if (!raw || typeof raw !== 'object') {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    );
  }
  const b = raw as EmitBody;

  if (typeof b.kind !== 'string' || !KNOWN_KINDS.has(b.kind as NotificationKind)) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_kind' },
      { status: 400, headers: NO_STORE },
    );
  }
  const kind = b.kind as NotificationKind;

  if (typeof b.symbol !== 'string' || !SYMBOL_RE.test(b.symbol)) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_symbol' },
      { status: 400, headers: NO_STORE },
    );
  }
  const symbol = b.symbol;

  const amount =
    typeof b.amount === 'string' && AMOUNT_RE.test(b.amount)
      ? b.amount
      : undefined;

  const refId =
    typeof b.ref_id === 'string' && REF_ID_RE.test(b.ref_id) ? b.ref_id : null;

  const level: NotificationLevel =
    typeof b.level === 'string' && KNOWN_LEVELS.has(b.level as NotificationLevel)
      ? (b.level as NotificationLevel)
      : kind === 'workflow_failed'
        ? 'error'
        : kind === 'workflow_executed' || kind === 'alert_resolved'
          ? 'success'
          : 'info';

  const txHash =
    typeof b.tx_hash === 'string' && TX_HASH_RE.test(b.tx_hash)
      ? b.tx_hash
      : undefined;
  const explorerUrl =
    typeof b.explorer_url === 'string' && URL_RE.test(b.explorer_url)
      ? b.explorer_url
      : undefined;
  const errorText =
    typeof b.error === 'string' && b.error.length > 0
      ? b.error.slice(0, 300)
      : undefined;
  const shortId =
    typeof b.short_id === 'string' && SHORT_ID_RE.test(b.short_id)
      ? b.short_id
      : undefined;
  const txShort =
    txHash && txHash.length > 12
      ? `${txHash.slice(0, 6)}…${txHash.slice(-4)}`
      : txHash;

  const body = composeBody(kind, {
    symbol,
    amount,
    txShort,
    error: errorText,
  });

  const row = insertNotification({
    wallet: session.wallet,
    kind,
    refId,
    level,
    body,
    meta: {
      symbol,
      ...(amount ? { amount } : {}),
      ...(txHash ? { tx_hash: txHash } : {}),
      ...(explorerUrl ? { explorer_url: explorerUrl } : {}),
      ...(shortId ? { short_id: shortId } : {}),
      ...(errorText ? { error: errorText } : {}),
    },
  });
  // `insertNotification` returns null on the dedupe path (an identical
  // notification within 60s). That's still a 200 — the client's job is
  // done, and repeating the emit is idempotent-by-design.
  return NextResponse.json(
    { ok: true, notification: row },
    { headers: NO_STORE },
  );
}
