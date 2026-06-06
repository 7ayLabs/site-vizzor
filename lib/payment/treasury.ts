/**
 * Treasury wallet configuration for site-owned payments.
 *
 * Each chain has separate mainnet / testnet treasury addresses so
 * dev and prod never collide. Resolution order per chain:
 *
 *   1. Network-specific env var (e.g. VIZZOR_SOLANA_TREASURY_DEVNET)
 *   2. Legacy single env var (e.g. VIZZOR_SOLANA_TREASURY) — interpreted
 *      as mainnet for backwards compatibility with v0.1.0 ops scripts
 *   3. Hard-coded developer placeholder so the checkout shell still
 *      renders something usable in local dev
 *
 * Mainnet treasuries are pre-screened against the OFAC SDN list before
 * deploy. Testnet treasuries are throwaway addresses; safe to commit
 * defaults to the repo.
 */

import { paymentNetwork } from './network';

/** Solana System Program address — useful as a recognizable testnet placeholder. */
const SOLANA_DEVNET_DEFAULT = '11111111111111111111111111111111';
/** TON testnet treasury placeholder (the address must start with 'k' or '0'). */
const TON_TESTNET_DEFAULT = '0QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
/** EVM testnet treasury placeholder. */
const EVM_TESTNET_DEFAULT = '0x0000000000000000000000000000000000000000';

export function solanaTreasury(): string {
  const n = paymentNetwork();
  if (n === 'mainnet') {
    return (
      process.env.VIZZOR_SOLANA_TREASURY_MAINNET ??
      process.env.VIZZOR_SOLANA_TREASURY ??
      SOLANA_DEVNET_DEFAULT
    );
  }
  if (n === 'testnet') {
    return (
      process.env.VIZZOR_SOLANA_TREASURY_TESTNET ??
      process.env.VIZZOR_SOLANA_TREASURY ??
      SOLANA_DEVNET_DEFAULT
    );
  }
  return (
    process.env.VIZZOR_SOLANA_TREASURY_DEVNET ??
    process.env.VIZZOR_SOLANA_TREASURY ??
    SOLANA_DEVNET_DEFAULT
  );
}

export function tonTreasury(): string {
  const main = paymentNetwork() === 'mainnet';
  if (main) {
    return (
      process.env.VIZZOR_TON_TREASURY_MAINNET ??
      process.env.VIZZOR_TON_TREASURY ??
      TON_TESTNET_DEFAULT
    );
  }
  return (
    process.env.VIZZOR_TON_TREASURY_TESTNET ??
    process.env.VIZZOR_TON_TREASURY ??
    TON_TESTNET_DEFAULT
  );
}

export function evmTreasury(chain: 'base' | 'arbitrum'): string {
  const main = paymentNetwork() === 'mainnet';
  if (chain === 'base') {
    if (main) {
      return (
        process.env.VIZZOR_EVM_TREASURY_BASE_MAINNET ??
        process.env.VIZZOR_EVM_TREASURY_BASE ??
        EVM_TESTNET_DEFAULT
      );
    }
    return (
      process.env.VIZZOR_EVM_TREASURY_BASE_TESTNET ??
      process.env.VIZZOR_EVM_TREASURY_BASE ??
      EVM_TESTNET_DEFAULT
    );
  }
  if (main) {
    return (
      process.env.VIZZOR_EVM_TREASURY_ARB_MAINNET ??
      process.env.VIZZOR_EVM_TREASURY_ARB ??
      EVM_TESTNET_DEFAULT
    );
  }
  return (
    process.env.VIZZOR_EVM_TREASURY_ARB_TESTNET ??
    process.env.VIZZOR_EVM_TREASURY_ARB ??
    EVM_TESTNET_DEFAULT
  );
}
