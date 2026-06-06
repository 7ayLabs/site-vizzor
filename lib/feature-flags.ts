/**
 * Feature flags — single source of truth for runtime toggles.
 *
 * All flags are read from `process.env`. Public flags use the
 * `NEXT_PUBLIC_*` prefix so they're inlined into the client bundle at
 * build time; private flags (none yet) would stay server-only.
 *
 * v0.2.0 renames the legacy `isTokenLive()` to `isVzrLive()` to match
 * the upcoming $VZR token rebrand. The legacy name stays as a thin
 * alias for one release cycle so external imports (and any cached
 * deployments) keep working; new code should call `isVzrLive()`.
 */

const DEFAULT_FREE_PREDICTIONS = 3;
const DEFAULT_PAYMENT_RATE_LOCK_SECONDS = 5 * 60;

/**
 * Gates the burn-to-predict UI and the $VIZZOR/$VZR per-tier discount
 * column in the order summary. False until the token contract goes
 * live on Solana mainnet AND legal sign-off lands. Read both the new
 * NEXT_PUBLIC_VZR_LIVE and the legacy NEXT_PUBLIC_TOKEN_LIVE so the
 * env-var rename can be staged independently of code deploys.
 */
export function isVzrLive(): boolean {
  return (
    process.env.NEXT_PUBLIC_VZR_LIVE === 'true' ||
    process.env.NEXT_PUBLIC_TOKEN_LIVE === 'true'
  );
}

/**
 * Deprecated — kept for one release so transitive imports don't
 * break. Removes in v0.3.0. Call `isVzrLive()` instead.
 */
export function isTokenLive(): boolean {
  return isVzrLive();
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
 * v0.2.0 — Base USDC plan payments (EVM L2 stablecoin, 5% flat
 * discount). Requires VIZZOR_EVM_TREASURY_BASE to be configured
 * server-side; the EVM watcher refuses to start otherwise.
 */
export function acceptUsdcBasePayments(): boolean {
  return process.env.NEXT_PUBLIC_ACCEPT_USDC_BASE === 'true';
}

/**
 * v0.2.0 — Arbitrum USDC plan payments (EVM L2 stablecoin, 5% flat
 * discount). Same provisioning contract as Base; the EVM watcher
 * runs one polling loop per enabled chain.
 */
export function acceptUsdcArbPayments(): boolean {
  return process.env.NEXT_PUBLIC_ACCEPT_USDC_ARB === 'true';
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
