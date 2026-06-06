/**
 * Treasury wallet configuration for site-owned payments.
 *
 * Phase 1: a single fixed treasury address per chain. Each payment
 * session uses the same address but the watcher disambiguates by:
 *   (a) the memo program instruction carrying the session id
 *   (b) the expected amount (rate-locked at session create)
 *
 * Phase 2 (later): HD derivation for per-session unique addresses.
 * The DB schema already supports it — `payment_sessions.dest_address`
 * is per-row.
 *
 * Env vars:
 *   VIZZOR_TON_TREASURY        — TON friendly address
 *   VIZZOR_SOLANA_TREASURY     — Solana base58 wallet owning the
 *                                 $VIZZOR treasury ATA
 */

export function tonTreasury(): string {
  // Default to a placeholder testnet address for dev; production
  // must set this env to a real mainnet address.
  return (
    process.env.VIZZOR_TON_TREASURY ??
    'UQDYzZmfsrGzhObKJUw4gzdeIxC_uFiTYUlhUVrn6N5_VsX5'
  );
}

export function solanaTreasury(): string {
  return (
    process.env.VIZZOR_SOLANA_TREASURY ??
    '11111111111111111111111111111111'
  );
}

/**
 * EVM USDC treasury address for the given chain. Production must
 * configure both per-chain env vars before flipping
 * acceptUsdc*Payments() to true; the EVM watcher refuses to start
 * for any chain whose treasury is missing.
 *
 * Throws on missing config so the watcher surface logs a clear
 * `treasury missing` message rather than silently confirming
 * payments to the zero address.
 */
export function evmTreasury(chain: 'base' | 'arbitrum'): string {
  const env = chain === 'base'
    ? process.env.VIZZOR_EVM_TREASURY_BASE
    : process.env.VIZZOR_EVM_TREASURY_ARB;
  if (!env || !/^0x[a-fA-F0-9]{40}$/.test(env)) {
    throw new Error(
      `EVM treasury not configured for ${chain} — set VIZZOR_EVM_TREASURY_${chain.toUpperCase()}`,
    );
  }
  return env;
}
