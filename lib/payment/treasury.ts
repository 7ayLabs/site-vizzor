/**
 * Treasury wallet configuration for site-owned payments.
 *
 * v0.2.0 ships Solana-native-only with a single fixed treasury address.
 * Each payment session uses the same address; the watcher disambiguates
 * concurrent payments by:
 *   (a) the memo program instruction carrying the session id
 *   (b) the expected amount (rate-locked at session create)
 *
 * Env var: VIZZOR_SOLANA_TREASURY — base58 wallet address that receives
 * native SOL transfers from /pay/* sessions.
 */

export function solanaTreasury(): string {
  return (
    process.env.VIZZOR_SOLANA_TREASURY ??
    '11111111111111111111111111111111'
  );
}
