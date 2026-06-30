/**
 * POST /api/predict/feedback — record 👍 / 👎 on an assistant turn.
 *
 * Body: { conversation_id: string, message_id: string,
 *          value: 'up' | 'down' | null }
 *
 *   - SIWS-gated (mirrors the rest of /predict).
 *   - Ownership-checked via `getConversationForWallet` so a wallet can
 *     only vote on conversations it owns. Returns 403 otherwise (the
 *     server never leaks which other wallet a conversation might belong
 *     to).
 *   - Rate-limited per IP + per wallet on the `predict.feedback` bucket
 *     (60/min on each side) — enough headroom for a user to toggle
 *     freely, narrow enough to make calibration farming visible.
 *   - Persists locally to `message_feedback` first, then best-effort
 *     forwards to `${VIZZOR_API_URL}/v1/feedback` with a 3s timeout so
 *     engine outage never blocks the UI (mirrors the snapshot fallback
 *     contract).
 */

import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import {
  enforceRateLimit,
  enforceWalletRateLimit,
} from '@/lib/payment/rate-limit';
import { recordAudit, actorFromWallet } from '@/lib/payment/audit';
import {
  getConversationForWallet,
  setMessageFeedback,
  type MessageFeedbackValue,
} from '@/lib/payment/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FORWARD_TIMEOUT_MS = 3_000;

function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

export async function POST(req: Request) {
  const ipLimited = enforceRateLimit(req, 'predict.feedback');
  if (ipLimited) return ipLimited as unknown as NextResponse;

  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const walletLimited = enforceWalletRateLimit(session.wallet, 'predict.feedback');
  if (walletLimited) return walletLimited as unknown as NextResponse;

  if (req.headers.get('content-type')?.includes('application/json') !== true) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_content_type' },
      { status: 415, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let body: { conversation_id?: unknown; message_id?: unknown; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!isValidId(body.conversation_id) || !isValidId(body.message_id)) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_id' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let value: MessageFeedbackValue | null;
  if (body.value === null) value = null;
  else if (body.value === 'up' || body.value === 'down') value = body.value;
  else {
    return NextResponse.json(
      { ok: false, reason: 'invalid_value' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Ownership check — the conversation must belong to the requesting
  // wallet. Returns 403 (not 404) on miss so this endpoint cannot be
  // used to enumerate which conversation IDs exist for other wallets.
  const conversation = getConversationForWallet(body.conversation_id, session.wallet);
  if (!conversation) {
    return NextResponse.json(
      { ok: false, reason: 'forbidden' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  setMessageFeedback({
    messageId: body.message_id,
    conversationId: body.conversation_id,
    wallet: session.wallet,
    value,
  });

  recordAudit({
    eventType: value === null ? 'predict.feedback.clear' : 'predict.feedback.set',
    actor: actorFromWallet(session.wallet),
    subject: body.message_id,
    outcome: 'ok',
    req,
  });

  // Best-effort upstream forward — never blocks the client. The engine
  // endpoint is on a coordinated PR; until it ships, a 404 is expected
  // and silently swallowed.
  void forwardToEngine({
    wallet: session.wallet,
    conversationId: body.conversation_id,
    messageId: body.message_id,
    value,
  });

  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

async function forwardToEngine(payload: {
  wallet: string;
  conversationId: string;
  messageId: string;
  value: MessageFeedbackValue | null;
}): Promise<void> {
  const base =
    process.env.VIZZOR_API_URL ??
    process.env.NEXT_PUBLIC_VIZZOR_API_URL ??
    'https://api.vizzor.ai';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const apiKey = process.env.VIZZOR_API_KEY;
    if (apiKey) headers['x-api-key'] = apiKey;
    await fetch(`${base}/v1/feedback`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        wallet: payload.wallet,
        conversation_id: payload.conversationId,
        message_id: payload.messageId,
        value: payload.value,
      }),
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch {
    // Engine outage / 404 / timeout — swallow. The local row is authoritative;
    // a reconciliation job can replay if needed.
  } finally {
    clearTimeout(timer);
  }
}
