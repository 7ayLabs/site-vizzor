/**
 * Feature flags — single source of truth for runtime toggles.
 *
 * All flags are read from `process.env`. Public flags use the
 * `NEXT_PUBLIC_*` prefix so they're inlined into the client bundle at
 * build time.
 *
 * v0.2.0 ships Solana-native-only — TON / EVM-USDC / $VZR multi-chain
 * support was removed in favor of a single, well-tested rail.
 */

const DEFAULT_FREE_PREDICTIONS = 3;
const DEFAULT_PAYMENT_RATE_LOCK_SECONDS = 5 * 60;

export function freePredictions(): number {
  const raw = process.env.NEXT_PUBLIC_FREE_PREDICTIONS;
  if (!raw) return DEFAULT_FREE_PREDICTIONS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FREE_PREDICTIONS;
}

/**
 * Gates the /pay/* checkout shell and the Solana watcher daemon.
 * When false (default), the route renders a "payment infrastructure
 * pending" panel and the watcher refuses to boot. Flip to true once
 * the treasury address is set and the watcher has been validated.
 */
export function acceptSolanaPayments(): boolean {
  return process.env.NEXT_PUBLIC_ACCEPT_SOLANA_PAYMENTS === 'true';
}

/**
 * Lifetime of a payment session before the locked USD-to-SOL rate
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
