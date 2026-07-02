/**
 * GET /api/notifications — wallet-scoped notification feed.
 *
 * Read shape:
 *   { ok: true, counts: { workflows, alerts, total }, items: NotificationRow[] }
 *
 * `counts` is the unread-count summary the sidebar badges consume;
 * `items` is a page of recent notifications (default 50). Both live
 * in the same response so a single poll drives both surfaces without
 * a follow-up call.
 *
 * PATCH /api/notifications — mark rows as read.
 *
 * Body:
 *   { ids: string[] }                — mark specific rows
 *   { all: true, bucket?: 'workflows' | 'alerts' }  — mark everything
 *                                                     (optionally per bucket)
 *
 * Wallet is derived server-side from the SIWS session; the client
 * cannot pass a `wallet` field. Every row is scoped to the requesting
 * wallet by the DB layer — a hostile client passing another user's
 * `id` gets a silent no-op.
 */

import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import { enforceWalletRateLimit } from '@/lib/payment/rate-limit';
import {
  getUnreadNotificationCounts,
  listNotificationsForWallet,
  markAllNotificationsRead,
  markNotificationsRead,
  type NotificationBucket,
} from '@/lib/payment/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const KNOWN_BUCKETS: ReadonlySet<NotificationBucket> = new Set([
  'workflows',
  'alerts',
]);
const ID_RE = /^ntf_[a-z0-9_]{4,64}$/i;
const MAX_IDS_PER_CALL = 200;

export async function GET(req: Request) {
  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401, headers: NO_STORE },
    );
  }
  const limited = enforceWalletRateLimit(session.wallet, 'notifications.read');
  if (limited) return limited as unknown as NextResponse;

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get('limit') ?? '50');
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 200
      ? Math.floor(limitParam)
      : 50;

  const counts = getUnreadNotificationCounts(session.wallet);
  const items = listNotificationsForWallet(session.wallet, limit);
  return NextResponse.json(
    { ok: true, counts, items },
    { headers: NO_STORE },
  );
}

export async function PATCH(req: Request) {
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
  const limited = enforceWalletRateLimit(session.wallet, 'notifications.write');
  if (limited) return limited as unknown as NextResponse;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    );
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    );
  }
  const b = body as { ids?: unknown; all?: unknown; bucket?: unknown };

  if (b.all === true) {
    const bucket =
      typeof b.bucket === 'string' &&
      KNOWN_BUCKETS.has(b.bucket as NotificationBucket)
        ? (b.bucket as NotificationBucket)
        : undefined;
    const updated = markAllNotificationsRead(session.wallet, bucket);
    return NextResponse.json(
      { ok: true, updated },
      { headers: NO_STORE },
    );
  }

  if (!Array.isArray(b.ids)) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    );
  }
  const rawIds = b.ids as unknown[];
  if (rawIds.length > MAX_IDS_PER_CALL) {
    return NextResponse.json(
      { ok: false, reason: 'too_many_ids' },
      { status: 400, headers: NO_STORE },
    );
  }
  const ids = rawIds.filter(
    (x): x is string => typeof x === 'string' && ID_RE.test(x),
  );
  const updated = markNotificationsRead(session.wallet, ids);
  return NextResponse.json({ ok: true, updated }, { headers: NO_STORE });
}
