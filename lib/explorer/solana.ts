/**
 * Solana explorer URL builders.
 *
 * Two explorers are linked from the app: Solscan (default — UX wins
 * for retail) and Solana Explorer (canonical first-party). Both accept
 * a `cluster` query param when the txn isn't on mainnet. Devnet/testnet
 * URLs without that param redirect to the mainnet view and 404 on the
 * signature, which is a confusing UX failure mode the helpers avoid.
 *
 * Network is sourced from `paymentNetwork()` so the same explorer URL
 * builder works across staging (devnet), test environments (testnet),
 * and production (mainnet) without per-environment branching.
 */

import type { PaymentNetwork } from '@/lib/payment/network';

function clusterQuery(network: PaymentNetwork): string {
  // Mainnet is the default for every explorer — no query param needed,
  // and adding `?cluster=mainnet-beta` produces uglier shareable URLs.
  if (network === 'mainnet') return '';
  // Solscan + Solana Explorer both accept `cluster=devnet|testnet`.
  return `?cluster=${network}`;
}

/** Solscan transaction URL. */
export function buildSolscanTxUrl(
  signature: string,
  network: PaymentNetwork,
): string {
  return `https://solscan.io/tx/${signature}${clusterQuery(network)}`;
}

/** Solscan account/address URL. */
export function buildSolscanAccountUrl(
  address: string,
  network: PaymentNetwork,
): string {
  return `https://solscan.io/account/${address}${clusterQuery(network)}`;
}

/** Solana Explorer transaction URL. */
export function buildSolanaExplorerTxUrl(
  signature: string,
  network: PaymentNetwork,
): string {
  // Solana Explorer uses `mainnet-beta` (not `mainnet`) when explicit;
  // we keep it omitted on mainnet since that's the default. For non-
  // mainnet clusters it accepts `devnet` / `testnet` directly.
  return `https://explorer.solana.com/tx/${signature}${clusterQuery(network)}`;
}

/** Solana Explorer account URL. */
export function buildSolanaExplorerAccountUrl(
  address: string,
  network: PaymentNetwork,
): string {
  return `https://explorer.solana.com/address/${address}${clusterQuery(network)}`;
}
