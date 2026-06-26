/**
 * TON explorer URL builders.
 *
 * Two explorers in common use: Tonviewer (UX-friendly) and Tonscan
 * (canonical). TON splits mainnet and testnet across separate subdomains
 * rather than a query param — Tonviewer uses `tonviewer.com` and
 * `testnet.tonviewer.com`, Tonscan uses `tonscan.org` and
 * `testnet.tonscan.org`. Devnet doesn't exist on TON; non-mainnet falls
 * through to testnet.
 */

import type { PaymentNetwork } from '@/lib/payment/network';

function tonHost(network: PaymentNetwork, mainnetHost: string): string {
  if (network === 'mainnet') return mainnetHost;
  // TON has no devnet — both testnet AND devnet land on the testnet
  // subdomain so the same helper works for both `staging` (devnet flag)
  // and explicit testnet deployments.
  return `testnet.${mainnetHost}`;
}

/** Tonviewer transaction URL (hash = base64url of the transaction hash). */
export function buildTonviewerTxUrl(
  hash: string,
  network: PaymentNetwork,
): string {
  return `https://${tonHost(network, 'tonviewer.com')}/transaction/${hash}`;
}

/** Tonviewer account URL. */
export function buildTonviewerAccountUrl(
  address: string,
  network: PaymentNetwork,
): string {
  return `https://${tonHost(network, 'tonviewer.com')}/${address}`;
}

/** Tonscan transaction URL. */
export function buildTonscanTxUrl(
  hash: string,
  network: PaymentNetwork,
): string {
  return `https://${tonHost(network, 'tonscan.org')}/tx/${hash}`;
}

/** Tonscan account URL. */
export function buildTonscanAccountUrl(
  address: string,
  network: PaymentNetwork,
): string {
  return `https://${tonHost(network, 'tonscan.org')}/address/${address}`;
}
