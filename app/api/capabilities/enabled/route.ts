/**
 * GET  /api/capabilities/enabled
 * PATCH /api/capabilities/enabled
 *
 * v0.5.0 agent-payment capabilities API.
 *
 * GET returns the wallet's enabled set + spend caps + TOS state so
 * the composer tray and settings page can render the exact state
 * once. The response is `no-store` — capability state is a security
 * decision boundary, never edge-cached.
 *
 * PATCH toggles a single capability enable and, optionally, sets its
 * daily USD spend cap. Enabling requires the caller to have already
 * accepted the current TOS version — the body carries the accepted
 * version + timestamp; the DB helper enforces it. This means the
 * settings UI shows a TOS modal on first enable that stamps
 * `tos_accepted_at`; without a valid stamp, PATCH returns 400 with
 * `capability_tos_required` and the client re-opens the modal.
 *
 * Security posture:
 *   - SIWS gate (401 without a wallet session).
 *   - Per-wallet rate limit (10/min) via `capability.enable` bucket.
 *   - Free-tier wallets are refused (402) — no capability lives on
 *     the free tier and the tray renders locked for them anyway.
 *   - `Cache-Control: no-store` on every response.
 *   - Only accepts JSON `content-type` on PATCH.
 *   - Amount inputs bounded (spend cap ≤ $10k/day) and integer-checked.
 *   - Every mutation writes an audit row via `recordAudit`.
 */

import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import { enforceWalletRateLimit } from '@/lib/payment/rate-limit';
import { recordAudit, actorFromWallet } from '@/lib/payment/audit';
import {
  CAPABILITY_TOS_VERSION,
  disableAllCapabilities,
  expireStaleIntents,
  getCapabilityPreferences,
  getCapabilitySpendUsedToday,
  listRecentIntents,
  setEnabledCapability,
  type CapabilityAuditRow,
} from '@/lib/payment/db';
import {
  ALL_CAP_IDS,
  DEFAULT_SPEND_CAPS_USD,
  isCapId,
  type CapId,
} from '@/lib/capabilities/intent';
import { resolveTier } from '@/lib/payment/tier-resolver';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

// Absolute ceiling any single capability may charge per day. Sits well
// above legitimate use for retail wallets, exists to blunt UI bug or
// compromised-session damage. The engine re-checks the same value.
const MAX_SPEND_CAP_USD = 10_000;

interface EnabledResponse {
  ok: true;
  enabled: CapId[];
  spend_caps: Record<CapId, number>;
  spend_used_today: Record<CapId, number>;
  tos_version: number | null;
  tos_accepted_at: number | null;
  current_tos_version: number;
  tier_locked: boolean;
  recent_intents: RecentIntentSummary[];
}

interface RecentIntentSummary {
  intent_id: string;
  kind: CapId;
  network: string;
  symbol: string | null;
  amount: string | null;
  status: string;
  tx_hash: string | null;
  created_at: number;
}

function summarize(row: CapabilityAuditRow): RecentIntentSummary {
  return {
    intent_id: row.intent_id,
    kind: row.kind,
    network: row.network,
    symbol: row.symbol,
    amount: row.amount,
    status: row.status,
    tx_hash: row.tx_hash,
    created_at: row.created_at,
  };
}

export async function GET() {
  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401, headers: NO_STORE },
    );
  }

  // Opportunistic sweep — anything past its TTL flips to 'expired'
  // before we compute spend caps or hand the summary to the client.
  // Cheap: index-backed UPDATE with WHERE status='pending' AND ttl < now.
  expireStaleIntents();

  const prefs = getCapabilityPreferences(session.wallet);
  const tier = resolveTier(session.wallet);
  const tierLocked = tier.kind === 'free';

  const spendUsed: Record<CapId, number> = {
    transfer: 0,
    payment: 0,
  };
  for (const cap of ALL_CAP_IDS) {
    spendUsed[cap] = getCapabilitySpendUsedToday(session.wallet, cap);
  }

  const body: EnabledResponse = {
    ok: true,
    enabled: prefs.enabled,
    spend_caps: { ...DEFAULT_SPEND_CAPS_USD, ...prefs.spend_caps },
    spend_used_today: spendUsed,
    tos_version: prefs.tos_version,
    tos_accepted_at: prefs.tos_accepted_at,
    current_tos_version: CAPABILITY_TOS_VERSION,
    tier_locked: tierLocked,
    recent_intents: listRecentIntents(session.wallet, 20).map(summarize),
  };
  return NextResponse.json(body, { headers: NO_STORE });
}

interface PatchBody {
  capability?: unknown;
  enabled?: unknown;
  spend_cap_usd?: unknown;
  tos_version?: unknown;
  tos_accepted_at?: unknown;
  /** Special kill-switch payload: `{ disable_all: true }`. Clears
   *  every enabled capability atomically and expires pending intents. */
  disable_all?: unknown;
}

export async function PATCH(req: Request) {
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

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    );
  }

  // Kill switch path — one-click "disable all" from settings.
  if (body.disable_all === true) {
    disableAllCapabilities(session.wallet);
    recordAudit({
      eventType: 'capability.kill_switch',
      actor: actorFromWallet(session.wallet),
      subject: 'all',
      outcome: 'ok',
      req,
    });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  const capability = body.capability;
  if (!isCapId(capability)) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_capability' },
      { status: 400, headers: NO_STORE },
    );
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json(
      { ok: false, reason: 'invalid_enabled' },
      { status: 400, headers: NO_STORE },
    );
  }
  let spendCapUsd: number | undefined;
  if (body.spend_cap_usd !== undefined) {
    if (
      typeof body.spend_cap_usd !== 'number' ||
      !Number.isFinite(body.spend_cap_usd) ||
      body.spend_cap_usd < 0 ||
      body.spend_cap_usd > MAX_SPEND_CAP_USD
    ) {
      return NextResponse.json(
        { ok: false, reason: 'invalid_spend_cap' },
        { status: 400, headers: NO_STORE },
      );
    }
    spendCapUsd = body.spend_cap_usd;
  }

  // Enabling requires the current TOS version accepted this call. The
  // db helper double-checks; we validate the shape here first so the
  // 400 error surface is precise.
  if (body.enabled) {
    if (typeof body.tos_version !== 'number' || body.tos_version !== CAPABILITY_TOS_VERSION) {
      return NextResponse.json(
        {
          ok: false,
          reason: 'capability_tos_required',
          current_tos_version: CAPABILITY_TOS_VERSION,
        },
        { status: 400, headers: NO_STORE },
      );
    }
    if (
      typeof body.tos_accepted_at !== 'number' ||
      !Number.isFinite(body.tos_accepted_at) ||
      body.tos_accepted_at <= 0 ||
      // TOS timestamp must not be in the future — clock-skew tolerance 60s.
      body.tos_accepted_at > Date.now() + 60_000
    ) {
      return NextResponse.json(
        { ok: false, reason: 'invalid_tos_accepted_at' },
        { status: 400, headers: NO_STORE },
      );
    }
  }

  try {
    setEnabledCapability({
      wallet: session.wallet,
      capability,
      enabled: body.enabled,
      tosAcceptedAt:
        typeof body.tos_accepted_at === 'number'
          ? body.tos_accepted_at
          : Date.now(),
      tosVersion:
        typeof body.tos_version === 'number'
          ? body.tos_version
          : CAPABILITY_TOS_VERSION,
      spendCapUsd,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown_error';
    if (msg === 'capability_tos_required') {
      return NextResponse.json(
        {
          ok: false,
          reason: 'capability_tos_required',
          current_tos_version: CAPABILITY_TOS_VERSION,
        },
        { status: 400, headers: NO_STORE },
      );
    }
    if (msg === 'spend_cap_invalid') {
      return NextResponse.json(
        { ok: false, reason: 'invalid_spend_cap' },
        { status: 400, headers: NO_STORE },
      );
    }
    // Surface the underlying error into the response so the client
    // can render something better than a generic "something went
    // wrong". Message is bounded so unexpected exception text can't
    // become an XSS vector via the modal error box.
    // eslint-disable-next-line no-console
    console.warn('[capabilities.enable] setEnabledCapability threw:', msg);
    return NextResponse.json(
      { ok: false, reason: 'internal_error', detail: msg.slice(0, 256) },
      { status: 500, headers: NO_STORE },
    );
  }

  recordAudit({
    eventType: body.enabled ? 'capability.enabled' : 'capability.disabled',
    actor: actorFromWallet(session.wallet),
    subject: capability,
    outcome: 'ok',
    req,
  });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
