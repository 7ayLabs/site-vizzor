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

import { acceptTonPayments, acceptVizzorPayments } from '@/lib/feature-flags';

const UPSTREAM_TIMEOUT_MS = 8_000;

export type PaymentTier = 'pro' | 'elite';
export type PaymentCadence = 'monthly' | 'annual' | 'lifetime';
/** Phase 1 supports two (chain, token) combos: (ton, native), (solana, vizzor). */
export type PaymentChain = 'ton' | 'solana';
export type PaymentToken = 'native' | 'vizzor';

export interface CreateSessionInput {
  tier: PaymentTier;
  cadence: PaymentCadence;
  chain: PaymentChain;
  token: PaymentToken;
  /**
   * Net USD amount in cents the user should pay AFTER any token-specific
   * discount. The engine recalculates the discount independently and
   * rejects on mismatch.
   */
  amountUsdCents: number;
  /** Discount basis points the site applied (0 for non-token paths). */
  discountBps: number;
}

export interface PaymentSession {
  sessionId: string;
  /** TON wallet address or Solana ATA depending on chain. Opaque to the site. */
  destAddress: string;
  /** Amount in token human units (e.g. 4.67 TON, or 1240.5 $VIZZOR). */
  amount: number;
  /** Token decimal places (TON: 9, $VIZZOR: 9 typical). */
  decimals: number;
  /** Net USD amount in cents after discount. */
  amountUsdCents: number;
  tier: PaymentTier;
  cadence: PaymentCadence;
  chain: PaymentChain;
  token: PaymentToken;
  /** Engine-locked rate at session creation (USD per single token unit). */
  rateLocked: number;
  /** Discount basis points applied (0 for native payments). */
  discountBps: number;
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
  // Each (chain, token) combo has its own feature flag so they ship
  // independently and can be toggled separately at launch.
  const isTon = input.chain === 'ton' && input.token === 'native';
  const isVizzor = input.chain === 'solana' && input.token === 'vizzor';

  if (isTon && !acceptTonPayments()) {
    return { ok: false, reason: 'feature_disabled' };
  }
  if (isVizzor && !acceptVizzorPayments()) {
    return { ok: false, reason: 'feature_disabled' };
  }
  if (!isTon && !isVizzor) {
    return { ok: false, reason: 'invalid_input' };
  }

  if (!['pro', 'elite'].includes(input.tier)) {
    return { ok: false, reason: 'invalid_input' };
  }
  if (!['monthly', 'annual', 'lifetime'].includes(input.cadence)) {
    return { ok: false, reason: 'invalid_input' };
  }
  if (
    !Number.isFinite(input.amountUsdCents) ||
    input.amountUsdCents < 49 ||
    input.amountUsdCents > 1_000_000
  ) {
    return { ok: false, reason: 'invalid_input' };
  }
  if (
    !Number.isFinite(input.discountBps) ||
    input.discountBps < 0 ||
    input.discountBps > 5000
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
  // Either flag enables session reads — a confirmed session for the
  // disabled path still needs to render its grant code on /pay/success.
  if (!acceptTonPayments() && !acceptVizzorPayments()) {
    return { ok: false, reason: 'feature_disabled' };
  }
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
  if (!acceptTonPayments() && !acceptVizzorPayments()) return null;

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
