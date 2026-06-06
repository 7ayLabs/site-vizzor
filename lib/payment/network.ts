/**
 * Payment network resolution — mainnet vs testnet.
 *
 * Resolution order:
 *   1. Explicit override via NEXT_PUBLIC_PAYMENT_NETWORK ('mainnet' | 'testnet').
 *   2. Default by NODE_ENV — production = mainnet, otherwise testnet.
 *
 * Per-chain testnet mapping:
 *   - Solana   → devnet
 *   - TON      → TON testnet
 *   - Base     → Base Sepolia (chain id 84532)
 *   - Arbitrum → Arbitrum Sepolia (chain id 421614)
 *
 * The helper is safe to import from BOTH client and server code — the
 * env reads are pure and there are no Node-only deps.
 */

export type PaymentNetwork = 'mainnet' | 'testnet';

export function paymentNetwork(): PaymentNetwork {
  const override = process.env.NEXT_PUBLIC_PAYMENT_NETWORK;
  if (override === 'mainnet' || override === 'testnet') return override;
  return process.env.NODE_ENV === 'production' ? 'mainnet' : 'testnet';
}

export function isMainnet(): boolean {
  return paymentNetwork() === 'mainnet';
}

export function isTestnet(): boolean {
  return paymentNetwork() === 'testnet';
}

/** Display label per chain × network. */
export function networkLabel(
  chain: 'solana' | 'ton' | 'base' | 'arbitrum',
): string {
  const main = paymentNetwork() === 'mainnet';
  switch (chain) {
    case 'solana':
      return main ? 'Solana mainnet' : 'Solana devnet';
    case 'ton':
      return main ? 'TON mainnet' : 'TON testnet';
    case 'base':
      return main ? 'Base mainnet' : 'Base Sepolia';
    case 'arbitrum':
      return main ? 'Arbitrum One' : 'Arbitrum Sepolia';
  }
}

/** EVM chain id per chain × network. Used by EVM wallet flows. */
export function evmChainId(chain: 'base' | 'arbitrum'): number {
  const main = paymentNetwork() === 'mainnet';
  if (chain === 'base') return main ? 8453 : 84532;
  return main ? 42161 : 421614;
}
