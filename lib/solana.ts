/**
 * Solana shared constants and env-driven config.
 *
 * Safe to import from BOTH client and server code. v0.2.0 ships
 * Solana-native-only: no $VIZZOR mint, no burn flow, no SPL helpers.
 *
 * RPC: server-side `SOLANA_RPC_URL` (Helius free tier recommended).
 * Constants come from `NEXT_PUBLIC_*` env vars so the same values are
 * visible to client code that builds the payment transaction.
 */

export function solanaRpcUrl(): string {
  return (
    process.env.SOLANA_RPC_URL ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    'https://api.mainnet-beta.solana.com'
  );
}

/**
 * Production-safe wrapper around `solanaRpcUrl()`. Throws if running in
 * production without a dedicated RPC configured.
 *
 * The public mainnet-beta default is rate-limited and unsafe for the
 * payment watcher under load. Failing closed at startup is preferable
 * to a quiet degradation that surfaces as confirmation latency to
 * paying users.
 */
export function getRpc(): string {
  if (
    process.env.NODE_ENV === 'production' &&
    !process.env.SOLANA_RPC_URL &&
    !process.env.NEXT_PUBLIC_SOLANA_RPC_URL
  ) {
    throw new Error(
      '[vizzor-solana] refusing to call RPC: SOLANA_RPC_URL is unset in production. ' +
        'The public mainnet-beta default is rate-limited and unsafe under load. ' +
        'Configure a dedicated provider and set SOLANA_RPC_URL. ' +
        'See docs/ops/secrets.md.',
    );
  }
  return solanaRpcUrl();
}
