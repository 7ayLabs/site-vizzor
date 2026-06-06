/**
 * Payment network resolution — three clusters, not two.
 *
 * Solana operates three public clusters and we map our deployment
 * tiers 1:1 onto them. Mixing testnet and devnet is a common mistake
 * because both are "non-prod" — but they are operationally distinct:
 * testnet is used by validators (gets reset to ship new versions),
 * while devnet hosts the developer faucet and is the conventional
 * surface for application iteration.
 *
 *   - production  → mainnet (Solana mainnet-beta / TON mainnet / Base / Arbitrum)
 *   - test        → testnet (Solana testnet / TON testnet / Base Sepolia / Arbitrum Sepolia)
 *   - everything else (dev) → devnet (Solana devnet / TON testnet / Base Sepolia / Arbitrum Sepolia)
 *
 * For TON and EVM chains, devnet and testnet collapse to the same
 * physical chain (TON testnet, Base Sepolia, Arbitrum Sepolia) — only
 * Solana exposes three.
 *
 * Resolution order:
 *   1. Explicit override via NEXT_PUBLIC_PAYMENT_NETWORK
 *      ('mainnet' | 'testnet' | 'devnet').
 *   2. Default by NODE_ENV — production → mainnet, test → testnet,
 *      otherwise → devnet.
 */

export type PaymentNetwork = 'mainnet' | 'testnet' | 'devnet';

export function paymentNetwork(): PaymentNetwork {
  const override = process.env.NEXT_PUBLIC_PAYMENT_NETWORK;
  if (
    override === 'mainnet' ||
    override === 'testnet' ||
    override === 'devnet'
  ) {
    return override;
  }
  if (process.env.NODE_ENV === 'production') return 'mainnet';
  if (process.env.NODE_ENV === 'test') return 'testnet';
  return 'devnet';
}

export function isMainnet(): boolean {
  return paymentNetwork() === 'mainnet';
}

/** True for non-production networks (testnet OR devnet). */
export function isNonProd(): boolean {
  return paymentNetwork() !== 'mainnet';
}

/** Compact label per chain × network. */
export function networkLabel(
  chain: 'solana' | 'ton' | 'base' | 'arbitrum',
): string {
  const n = paymentNetwork();
  switch (chain) {
    case 'solana':
      return n === 'mainnet'
        ? 'Solana mainnet'
        : n === 'testnet'
          ? 'Solana testnet'
          : 'Solana devnet';
    case 'ton':
      return n === 'mainnet' ? 'TON mainnet' : 'TON testnet';
    case 'base':
      return n === 'mainnet' ? 'Base mainnet' : 'Base Sepolia';
    case 'arbitrum':
      return n === 'mainnet' ? 'Arbitrum One' : 'Arbitrum Sepolia';
  }
}

/** Display badge text for the current network. */
export function networkBadgeLabel(): string {
  const n = paymentNetwork();
  if (n === 'mainnet') return 'MAINNET';
  if (n === 'testnet') return 'TESTNET';
  return 'DEVNET';
}

/** EVM chain id per chain × network. */
export function evmChainId(chain: 'base' | 'arbitrum'): number {
  const main = paymentNetwork() === 'mainnet';
  if (chain === 'base') return main ? 8453 : 84532;
  return main ? 42161 : 421614;
}
