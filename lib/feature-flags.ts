/**
 * Feature flags — single source of truth for runtime toggles.
 *
 * All flags are read from `process.env`. Public flags use the
 * `NEXT_PUBLIC_*` prefix so they're inlined into the client bundle at
 * build time; private flags (none yet) would stay server-only.
 *
 * Phase 1 ships with `isTokenLive()` returning false — the paid path
 * exists in code but renders a "launching soon" panel until the
 * $VIZZOR contract is on-chain and `NEXT_PUBLIC_TOKEN_LIVE=true`.
 */

const DEFAULT_FREE_PREDICTIONS = 3;
const DEFAULT_PAYMENT_RATE_LOCK_SECONDS = 5 * 60;

export function isTokenLive(): boolean {
  return process.env.NEXT_PUBLIC_TOKEN_LIVE === 'true';
}

export function freePredictions(): number {
  const raw = process.env.NEXT_PUBLIC_FREE_PREDICTIONS;
  if (!raw) return DEFAULT_FREE_PREDICTIONS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FREE_PREDICTIONS;
}

/**
 * When false (default), the /pay/* checkout shell renders a clear
 * "payment infrastructure pending" state and the /pricing cadence
 * CTAs stay disabled. Flip to true once the engine ships the
 * /v1/payment/* + /v1/grants/* endpoints AND legal sign-off lands.
 */
export function acceptTonPayments(): boolean {
  return process.env.NEXT_PUBLIC_ACCEPT_TON_PAYMENTS === 'true';
}

/**
 * Phase-1 #2 chain — Solana $VIZZOR payments with tier-specific
 * discount (25/30/35% off depending on cadence). Gated separately
 * from TON so each can ship independently.
 */
export function acceptVizzorPayments(): boolean {
  return process.env.NEXT_PUBLIC_ACCEPT_VIZZOR_PAYMENTS === 'true';
}

/**
 * Lifetime of a payment session before the locked USD-to-TON rate
 * expires. Defaults to 5 minutes.
 */
export function paymentRateLockSeconds(): number {
  const raw = process.env.NEXT_PUBLIC_PAYMENT_RATE_LOCK_SECONDS;
  if (!raw) return DEFAULT_PAYMENT_RATE_LOCK_SECONDS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 60 && n <= 3600
    ? n
    : DEFAULT_PAYMENT_RATE_LOCK_SECONDS;
}
