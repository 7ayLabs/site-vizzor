/**
 * Solana shared constants and env-driven config.
 *
 * Network resolution (see lib/payment/network.ts):
 *   - mainnet → operator-configured RPC or public-RPC fallback
 *   - testnet → api.testnet.solana.com (validator-test cluster)
 *   - devnet  → api.devnet.solana.com  (developer cluster, faucet enabled)
 *
 * Env precedence per cluster:
 *   1. Cluster-specific override
 *      SOLANA_RPC_URL_{MAINNET,TESTNET,DEVNET}
 *      NEXT_PUBLIC_SOLANA_RPC_URL_{MAINNET,TESTNET,DEVNET}
 *   2. Generic SOLANA_RPC_URL / NEXT_PUBLIC_SOLANA_RPC_URL — applied
 *      to whichever cluster is active.
 *   3. Cluster default fallback (see below).
 */

import { paymentNetwork } from './payment/network';

const MAINNET_FALLBACK = 'https://solana-rpc.publicnode.com';
const TESTNET_FALLBACK = 'https://api.testnet.solana.com';
const DEVNET_FALLBACK = 'https://api.devnet.solana.com';

export function solanaRpcUrl(): string {
  const network = paymentNetwork();

  if (network === 'mainnet') {
    return (
      process.env.SOLANA_RPC_URL_MAINNET ??
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL_MAINNET ??
      process.env.SOLANA_RPC_URL ??
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
      MAINNET_FALLBACK
    );
  }

  if (network === 'testnet') {
    return (
      process.env.SOLANA_RPC_URL_TESTNET ??
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL_TESTNET ??
      process.env.SOLANA_RPC_URL ??
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
      TESTNET_FALLBACK
    );
  }

  return (
    process.env.SOLANA_RPC_URL_DEVNET ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL_DEVNET ??
    process.env.SOLANA_RPC_URL ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    DEVNET_FALLBACK
  );
}

/**
 * Production-safe wrapper. Throws if running in production *mainnet*
 * without a dedicated RPC. Non-mainnet clusters are exempt — both
 * api.testnet.solana.com and api.devnet.solana.com are operator-
 * acceptable.
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
