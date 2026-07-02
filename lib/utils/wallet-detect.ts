/**
 * Solana wallet-address detection — used by the composer overlay and
 * the user chat bubble to give addresses a visual affordance the user
 * can spot at a glance.
 *
 * Design posture: loose but useful. We match anything that LOOKS like
 * a Solana base58 address (32–44 chars, base58 alphabet). We don't
 * ed25519-validate — that's the wallet's job when it actually signs.
 * A false-positive on a long base58-looking word (e.g. a compact
 * hash) styled as an address is a small cost; a false-negative on a
 * real address the user pasted is worse (they lose the affordance
 * that lets them verify visually).
 *
 * The pattern is word-boundary anchored so an address glued to prose
 * (e.g. `send 0.1 SOL → 5oQ2u…` where the `→ ` isn't whitespace on
 * some keyboards) still hits.
 */

/**
 * Solana base58 alphabet (no `0`, `O`, `I`, `l`) captured 32–44 chars.
 * 32 is the minimum for a real ed25519 pubkey after base58; 44 is
 * the maximum. Anything outside that range is either too short to be
 * a real address (probably a filename or hash prefix) or too long
 * (probably a transaction signature — those are ~87 chars).
 */
export const WALLET_ADDRESS_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

/**
 * A single continuous byte match — used by the composer overlay to
 * decide which tokens belong to the wallet segment and by the user
 * bubble renderer to split the visible prose around each match.
 */
export interface WalletRange {
  start: number;
  end: number;
  addr: string;
}

/**
 * Extract every wallet-address range from `text`. Ranges are in
 * source order and non-overlapping (regex is greedy and word-
 * boundary anchored, so no ambiguity to resolve).
 */
export function findWalletRanges(text: string): WalletRange[] {
  const out: WalletRange[] = [];
  for (const m of text.matchAll(WALLET_ADDRESS_RE)) {
    if (typeof m.index === 'number') {
      out.push({
        start: m.index,
        end: m.index + m[0].length,
        addr: m[0],
      });
    }
  }
  return out;
}

/**
 * True when `text` (as a whole token, not a substring) reads as a
 * Solana wallet. Cheap word-level check used by the composer's
 * whitespace tokenizer where each token is examined in isolation.
 */
export function isWalletAddressToken(text: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text);
}
