/**
 * Solana shared constants and env-driven config.
 *
 * Safe to import from BOTH client and server code. v0.2.0 ships
 * Solana-native-only: no $VIZZOR mint, no burn flow, no SPL helpers.
 *
 * Network resolution (see lib/payment/network.ts):
 *   - mainnet → public-RPC fallback or operator-configured RPC
 *   - testnet → Solana devnet (browser-CORS-friendly, free)
 *
 * Env precedence:
 *   1. SOLANA_RPC_URL (server) / NEXT_PUBLIC_SOLANA_RPC_URL (client)
 *      — applies to whichever network is active.
 *   2. SOLANA_RPC_URL_DEVNET / NEXT_PUBLIC_SOLANA_RPC_URL_DEVNET
 *      — testnet-only override.
 *   3. SOLANA_RPC_URL_MAINNET / NEXT_PUBLIC_SOLANA_RPC_URL_MAINNET
 *      — mainnet-only override.
 *   4. Network default fallback.
 */

import { paymentNetwork } from './payment/network';

const MAINNET_FALLBACK = 'https://solana-rpc.publicnode.com';
const DEVNET_FALLBACK = 'https://api.devnet.solana.com';

export function solanaRpcUrl(): string {
  const main = paymentNetwork() === 'mainnet';

  if (main) {
    const explicit =
      process.env.SOLANA_RPC_URL_MAINNET ??
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL_MAINNET ??
      process.env.SOLANA_RPC_URL ??
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    if (explicit) return explicit;
    return MAINNET_FALLBACK;
  }

  const explicit =
    process.env.SOLANA_RPC_URL_DEVNET ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL_DEVNET ??
    process.env.SOLANA_RPC_URL ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (explicit) return explicit;
  return DEVNET_FALLBACK;
}

/**
 * Production-safe wrapper. Throws if running in production *mainnet*
 * without a dedicated RPC. Testnet is exempt — devnet's public
 * endpoint is operator-acceptable.
 */
export function getRpc(): string {
  if (
    process.env.NODE_ENV === 'production' &&
    paymentNetwork() === 'mainnet' &&
    !process.env.SOLANA_RPC_URL &&
    !process.env.SOLANA_RPC_URL_MAINNET
  ) {
    throw new Error(
      '[vizzor-solana] refusing to call RPC: no mainnet RPC configured in production. ' +
        'Set SOLANA_RPC_URL or SOLANA_RPC_URL_MAINNET to a dedicated provider. ' +
        'See docs/ops/secrets.md.',
    );
  }
  return solanaRpcUrl();
}
