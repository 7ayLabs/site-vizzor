/**
 * Payment session — thin proxy to the engine's /v1/payment/session API.
 *
 * The site does NOT mint sessions locally. The engine owns the master
 * HD wallet for destination-address derivation, the payment_sessions
 * Postgres table, and the TON watcher daemon. The site just routes
 * requests through and returns "offline" honest fallback when the
 * engine is unreachable. Same architectural discipline as /api/predict
 * → api.vizzor.ai/v1/chat.
 *
 * Per the plan, when the engine is down OR the feature flag is off,
 * we return null + a reason. The route handlers turn that into a
 * 503 with a user-readable explanation; the checkout UI surfaces it
 * as "payment infrastructure pending" rather than fabricating a
 * fake destination address.
 */

import { acceptTonPayments } from '@/lib/feature-flags';

const UPSTREAM_TIMEOUT_MS = 8_000;

export type PaymentTier = 'pro' | 'elite';
export type PaymentCadence = 'monthly' | 'annual' | 'lifetime';
export type PaymentChain = 'ton';

export interface CreateSessionInput {
  tier: PaymentTier;
  cadence: PaymentCadence;
  chain: PaymentChain;
  /** USD amount in cents (e.g. 999 = $9.99) — engine validates against tier table. */
  amountUsdCents: number;
}

export interface PaymentSession {
  sessionId: string;
  destAddress: string;
  amountTon: number;
  amountUsdCents: number;
  tier: PaymentTier;
  cadence: PaymentCadence;
  chain: PaymentChain;
  /** Engine-locked rate at session creation (USD per TON). */
  usdPerTonAtLock: number;
  /** Epoch ms when the session expires (rate lock window). */
  expiresAt: number;
  /** 'pending' | 'confirmed' | 'expired' | 'failed'. */
  status: 'pending' | 'confirmed' | 'expired' | 'failed';
  txSig?: string;
  confirmedAt?: number;
  grantCode?: string;
}

export type SessionResult =
  | { ok: true; session: PaymentSession }
  | { ok: false; reason: SessionFailure };

export type SessionFailure =
  | 'feature_disabled'
  | 'engine_offline'
  | 'invalid_input'
  | 'engine_error';

function engineBase(): string {
  return (
    process.env.VIZZOR_API_URL ??
    process.env.NEXT_PUBLIC_VIZZOR_API_URL ??
    'https://api.vizzor.ai'
  );
}

/** POST /v1/payment/session — proxy with offline-safe fallback. */
export async function createSession(
  input: CreateSessionInput,
): Promise<SessionResult> {
  if (!acceptTonPayments()) return { ok: false, reason: 'feature_disabled' };
  if (!['pro', 'elite'].includes(input.tier)) {
    return { ok: false, reason: 'invalid_input' };
  }
  if (!['monthly', 'annual', 'lifetime'].includes(input.cadence)) {
    return { ok: false, reason: 'invalid_input' };
  }
  if (input.chain !== 'ton') return { ok: false, reason: 'invalid_input' };
  if (
    !Number.isFinite(input.amountUsdCents) ||
    input.amountUsdCents < 99 ||
    input.amountUsdCents > 1_000_000
  ) {
    return { ok: false, reason: 'invalid_input' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const res = await fetch(`${engineBase()}/v1/payment/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, reason: 'engine_error' };
    const session = (await res.json()) as PaymentSession;
    return { ok: true, session };
  } catch {
    return { ok: false, reason: 'engine_offline' };
  } finally {
    clearTimeout(timeout);
  }
}

/** GET /v1/payment/session/:id — proxy with offline-safe fallback. */
export async function getSession(id: string): Promise<SessionResult> {
  if (!acceptTonPayments()) return { ok: false, reason: 'feature_disabled' };
  if (!/^[a-zA-Z0-9_\-]{8,64}$/.test(id)) {
    return { ok: false, reason: 'invalid_input' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const res = await fetch(
      `${engineBase()}/v1/payment/session/${encodeURIComponent(id)}`,
      {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      },
    );
    if (!res.ok) return { ok: false, reason: 'engine_error' };
    const session = (await res.json()) as PaymentSession;
    return { ok: true, session };
  } catch {
    return { ok: false, reason: 'engine_offline' };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * POST /v1/grants — mint a grant code for a confirmed session.
 * Returns the grant code on success, or null if the engine is
 * unreachable. Idempotent — the engine returns the existing grant
 * code if one was already minted for this session.
 */
export async function issueGrantForSession(
  sessionId: string,
): Promise<{ code: string } | null> {
  if (!acceptTonPayments()) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(`${engineBase()}/v1/grants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as { code: string };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
