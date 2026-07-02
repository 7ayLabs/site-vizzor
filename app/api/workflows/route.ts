/**
 * GET /api/workflows
 *
 * v0.5.1 — the /app/workflows page reads from here. Returns the
 * wallet's capability intents grouped by conversation so the UI can
 * render one card per conversation with its child intents underneath.
 *
 * Query params:
 *   conversation_id (optional) — narrow to a single conversation.
 *     Used by the chat-delete guard to check whether a specific
 *     conversation has active intents before letting delete proceed.
 *   status (optional) — comma-separated filter over intent status.
 *     Used by the delete guard to look only for pending + signed
 *     (terminal states don't block delete).
 *
 * Security posture:
 *   - SIWS gate (401 without a wallet session).
 *   - Per-wallet rate limit (reused `capability.enable` bucket —
 *     the workflows page never fetches more than once per interaction).
 *   - `Cache-Control: no-store` — capability state is a security
 *     decision boundary and never edge-cached.
 */

import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import { enforceWalletRateLimit } from '@/lib/payment/rate-limit';
import {
  countActiveIntentsForConversation,
  expireStaleIntents,
  listIntentsGroupedByConversation,
  type CapabilityAuditRow,
  type CapabilityIntentStatus,
} from '@/lib/payment/db';
import type { CapId } from '@/lib/capabilities/intent';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const STATUS_VALUES = new Set<CapabilityIntentStatus>([
  'pending',
  'signed',
  'executed',
  'failed',
  'expired',
]);

const CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

interface WorkflowIntent {
  intent_id: string;
  kind: CapId;
  network: string;
  symbol: string | null;
  amount: string | null;
  amount_usd: number | null;
  from_addr: string | null;
  to_addr: string | null;
  status: CapabilityIntentStatus;
  tx_hash: string | null;
  ttl_at: number;
  issued_at: number;
  signed_at: number | null;
  executed_at: number | null;
  created_at: number;
}

interface WorkflowGroup {
  conversation_id: string | null;
  conversation_title: string | null;
  intents: WorkflowIntent[];
}

interface WorkflowsResponse {
  ok: true;
  groups: WorkflowGroup[];
  /**
   * Only present when the request filtered by conversation_id AND
   * status. Lets the chat-delete guard read one field instead of
   * counting client-side.
   */
  active_count?: number;
  active_kinds?: CapId[];
}

function summarize(row: CapabilityAuditRow): WorkflowIntent {
  return {
    intent_id: row.intent_id,
    kind: row.kind,
    network: row.network,
    symbol: row.symbol,
    amount: row.amount,
    amount_usd: row.amount_usd,
    from_addr: row.from_addr,
    to_addr: row.to_addr,
    status: row.status,
    tx_hash: row.tx_hash,
    ttl_at: row.ttl_at,
    issued_at: row.issued_at,
    signed_at: row.signed_at,
    executed_at: row.executed_at,
    created_at: row.created_at,
  };
}

export async function GET(req: Request) {
  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401, headers: NO_STORE },
    );
  }
  const limited = enforceWalletRateLimit(session.wallet, 'capability.enable');
  if (limited) return limited as unknown as NextResponse;

  // Sweep stale intents to `expired` before reading so the page never
  // shows a "pending" intent that's already past its TTL. Cheap query
  // — indexed on (status, ttl_at).
  try {
    expireStaleIntents();
  } catch {
    /* not fatal — worst case the UI shows one stale row */
  }

  const url = new URL(req.url);
  const conversationIdParam = url.searchParams.get('conversation_id');
  const statusParam = url.searchParams.get('status');

  if (conversationIdParam !== null) {
    if (!CONVERSATION_ID_RE.test(conversationIdParam)) {
      return NextResponse.json(
        { ok: false, reason: 'invalid_conversation_id' },
        { status: 400, headers: NO_STORE },
      );
    }
  }
  let statusFilter: CapabilityIntentStatus[] | null = null;
  if (statusParam !== null) {
    const parts = statusParam
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is CapabilityIntentStatus =>
        STATUS_VALUES.has(s as CapabilityIntentStatus),
      );
    if (parts.length === 0) {
      return NextResponse.json(
        { ok: false, reason: 'invalid_status' },
        { status: 400, headers: NO_STORE },
      );
    }
    statusFilter = parts;
  }

  // Delete-guard fast path — one query, one number.
  if (conversationIdParam && statusFilter) {
    const wantsActiveOnly =
      statusFilter.length === 2 &&
      statusFilter.includes('pending') &&
      statusFilter.includes('signed');
    if (wantsActiveOnly) {
      const { count, kinds } = countActiveIntentsForConversation(
        session.wallet,
        conversationIdParam,
      );
      const body: WorkflowsResponse = {
        ok: true,
        groups: [],
        active_count: count,
        active_kinds: kinds,
      };
      return NextResponse.json(body, { headers: NO_STORE });
    }
  }

  const rawGroups = listIntentsGroupedByConversation(session.wallet);
  let groups: WorkflowGroup[] = rawGroups.map((g) => ({
    conversation_id: g.conversation_id,
    conversation_title: g.conversation_title,
    intents: g.intents.map(summarize),
  }));

  if (conversationIdParam !== null) {
    groups = groups.filter(
      (g) => g.conversation_id === conversationIdParam,
    );
  }
  if (statusFilter !== null) {
    groups = groups
      .map((g) => ({
        ...g,
        intents: g.intents.filter((i) => statusFilter!.includes(i.status)),
      }))
      .filter((g) => g.intents.length > 0);
  }

  return NextResponse.json({ ok: true, groups }, { headers: NO_STORE });
}
