/**
 * POST /api/capabilities/create-intent
 *
 * Manual intent creation gateway. In the fully-wired agent-payment
 * loop the engine's tool call is what produces a pending intent
 * (SSE `intent_required` event → `insertPendingIntent`). Until that
 * engine tool ships, users can still exercise the full sign +
 * settlement flow by drafting an intent from the composer's tray
 * icon. This route is that manual entry point.
 *
 * Same trust model as the automated path:
 *   - SIWS-gated wallet auth (401 otherwise).
 *   - Per-wallet rate limit via the `capability.enable` bucket.
 *   - Allow-list check against `wallet_preferences.enabled_capabilities`
 *     — the UI wouldn't let a user click a locked icon, but a hand-
 *     crafted POST could try; the DB is authoritative.
 *   - Free tier is refused (402) — capabilities require Pro/Elite.
 *   - Amount + address validation; USD pricing best-effort via the
 *     ticker snapshot cache.
 *   - Server-issued nonce + 60s TTL so the intent modal has a real
 *     clock; expired intents are refused at settlement.
 */

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import { enforceWalletRateLimit } from '@/lib/payment/rate-limit';
import { recordAudit, actorFromWallet } from '@/lib/payment/audit';
import {
  getCapabilityPreferences,
  insertPendingIntent,
} from '@/lib/payment/db';
import {
  buildCanonicalIntent,
  isCapId,
  isIntentNetwork,
  type CapId,
  type IntentNetwork,
  type PendingIntent,
} from '@/lib/capabilities/intent';
import { resolveTier } from '@/lib/payment/tier-resolver';
import { getTicker } from '@/lib/snapshot';

const CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const TTL_MS = 60_000;

const AMOUNT_RE = /^\d+(?:\.\d{1,18})?$/;
const ADDR_RE = /^[a-zA-Z0-9_-]{16,128}$/;
const SYMBOL_RE = /^[A-Z0-9]{1,16}$/;

interface CreateIntentBody {
  capability?: unknown;
  network?: unknown;
  to_addr?: unknown;
  symbol?: unknown;
  amount?: unknown;
  /**
   * v0.5.1 — the conversation this intent is being minted from.
   * Optional (legacy clients omit it); when present the intent is
   * linked so the workflows page can group by conversation and the
   * chat-delete guard can look up active intents.
   */
  conversation_id?: unknown;
}

export async function POST(req: Request) {
  if ((req.headers.get('content-type') ?? '').split(';')[0]?.trim() !==
      'application/json') {
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
  const limited = enforceWalletRateLimit(session.wallet, 'capability.enable');
  if (limited) return limited as unknown as NextResponse;

  const tier = resolveTier(session.wallet);
  if (tier.kind === 'free') {
    return NextResponse.json(
      { ok: false, reason: 'tier_required', required_tier: 'pro' },
      { status: 402, headers: NO_STORE },
    );
  }

  let body: CreateIntentBody;
  try {
    body = (await req.json()) as CreateIntentBody;
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    );
  }

  const capability = body.capability;
  const network = body.network;
  const toAddr = body.to_addr;
  const symbol = body.symbol;
  const amount = body.amount;
  if (
    !isCapId(capability) ||
    !isIntentNetwork(network) ||
    typeof toAddr !== 'string' ||
    !ADDR_RE.test(toAddr) ||
    typeof symbol !== 'string' ||
    !SYMBOL_RE.test(symbol.toUpperCase()) ||
    typeof amount !== 'string' ||
    !AMOUNT_RE.test(amount) ||
    Number(amount) <= 0
  ) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    );
  }
  const capId: CapId = capability;
  const net: IntentNetwork = network;
  const upperSymbol = symbol.toUpperCase();

  // Guard against self-transfer: from_addr and to_addr can't match.
  // (The session wallet is always the from_addr in the manual path —
  // Vizzor never signs on behalf of another wallet's tokens.)
  if (toAddr === session.wallet) {
    return NextResponse.json(
      { ok: false, reason: 'self_transfer' },
      { status: 400, headers: NO_STORE },
    );
  }

  // Allow-list — even if the UI thinks this capability is enabled,
  // the DB is authoritative. A stale client cache or hand-crafted
  // POST is rejected here.
  const prefs = getCapabilityPreferences(session.wallet);
  if (!prefs.enabled.includes(capId)) {
    return NextResponse.json(
      { ok: false, reason: 'capability_not_enabled' },
      { status: 403, headers: NO_STORE },
    );
  }

  // USD pricing — best-effort. Ticker snapshot is a build-time file
  // that also gets replaced by /api/snapshot at runtime, so this is
  // "cached spot price". If we can't price the amount, we still
  // create the intent but leave amount_usd null — the settlement
  // route treats that as 0 for cap calculations (unpriced intents
  // don't count against the daily cap, which is the safe posture:
  // an attacker can't hide spend behind an unpriced symbol because
  // spend_caps only exist for well-known symbols).
  const ticker = getTicker();
  const priceUsd = ticker.find(
    (t) => t.symbol?.toUpperCase() === upperSymbol,
  )?.price;
  const amountUsd =
    typeof priceUsd === 'number' && Number.isFinite(priceUsd) && priceUsd > 0
      ? Number(amount) * priceUsd
      : null;

  const nowMs = Date.now();
  const intentId = `itn_${randomUUID().replace(/-/g, '')}`;
  const nonce = `n_${randomUUID().replace(/-/g, '')}`;
  const intent: PendingIntent = {
    intent_id: intentId,
    kind: capId,
    network: net,
    from_addr: session.wallet,
    to_addr: toAddr,
    symbol: upperSymbol,
    amount,
    nonce,
    ttl_at: nowMs + TTL_MS,
    issued_at: nowMs,
    ...(typeof amountUsd === 'number'
      ? { network_fee: '0.000005' } // best-effort SOL rent estimate
      : {}),
  };
  const canonical = buildCanonicalIntent(intent);

  // v0.5.1 — accept an optional conversation_id linking this intent
  // to the chat that minted it. Validated against a strict regex so
  // a malicious body can't inject SQL-like tokens through the
  // conversation join used by the workflows page. Nulls through for
  // unlinked mints (settings UI, legacy clients).
  let conversationId: string | null = null;
  if (typeof body.conversation_id === 'string' && body.conversation_id) {
    if (!CONVERSATION_ID_RE.test(body.conversation_id)) {
      return NextResponse.json(
        { ok: false, reason: 'invalid_conversation_id' },
        { status: 400, headers: NO_STORE },
      );
    }
    conversationId = body.conversation_id;
  }

  try {
    insertPendingIntent({
      intentId,
      wallet: session.wallet,
      kind: capId,
      network: net,
      symbol: upperSymbol,
      amount,
      amountUsd,
      fromAddr: session.wallet,
      toAddr,
      canonical,
      nonce,
      issuedAt: nowMs,
      ttlAt: nowMs + TTL_MS,
      conversationId,
    });
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'intent_insert_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
  recordAudit({
    eventType: 'capability.intent.signed',
    actor: actorFromWallet(session.wallet),
    subject: intentId,
    outcome: 'ok',
    req,
  });
  return NextResponse.json({ ok: true, intent }, { headers: NO_STORE });
}
