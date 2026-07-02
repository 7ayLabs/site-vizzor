/**
 * Jupiter deep-link builder.
 *
 * Given a trade plan level (or a raw pair + amount), builds a
 * `https://jup.ag/swap/…` URL that opens Jupiter's terminal with
 * the swap pre-filled. Clicking the URL takes the user straight to
 * Jupiter with the input token, output token, and amount already
 * entered — one click on Jupiter's "Swap" button executes.
 *
 * This is the "1-click execute" path for Phase 1 of the auto-trade
 * roadmap: Vizzor writes a plan, the site renders a card, the user
 * hits [Open Jupiter] and completes the swap without any custody
 * infrastructure on the Vizzor side.
 *
 * URL format (Jupiter's documented shape):
 *   https://jup.ag/swap/<INPUT_MINT>-<OUTPUT_MINT>?amount=<AMOUNT>
 *
 * `<AMOUNT>` is in the input token's smallest unit (lamports for
 * SOL, 1e6 for USDC/USDT). Jupiter's UI accepts the raw uint64.
 *
 * Testnet/devnet has no Jupiter deployment — those clusters fall
 * back to a no-op that the caller can render as a disabled button
 * with an "only mainnet" tooltip.
 */

import type { TradeDirection } from './trade-plan';

/**
 * Well-known mints on Solana mainnet. Extended sparingly — only the
 * pairs the engine's trade plans can reasonably reference right now.
 * If the engine mentions a symbol not in this map, the deep-link
 * builder returns null and the UI hides the Jupiter button (Set
 * Alert still works, since alerts don't need a mint).
 */
const MAINNET_MINTS: Record<string, { mint: string; decimals: number }> = {
  SOL: { mint: 'So11111111111111111111111111111111111111112', decimals: 9 },
  USDC: {
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
  },
  USDT: {
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    decimals: 6,
  },
  BONK: { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5 },
  JUP: { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', decimals: 6 },
  JTO: { mint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', decimals: 9 },
  W: { mint: '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ', decimals: 6 },
  PYTH: { mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', decimals: 6 },
};

export interface JupiterSwapPlan {
  inputSymbol: string;
  outputSymbol: string;
  /** Amount in the INPUT token's whole units (e.g. 0.1 SOL, 42.5 USDC). */
  amountInWhole: number;
}

/**
 * Translate a trade-plan level into the corresponding Jupiter swap.
 *
 * A LONG plan on SOL sizes the OPEN as USDC→SOL and the CLOSE as
 * SOL→USDC. Entry means open, TP1/TP2/SL means close. Direction
 * flips for shorts. The base asset defaults to the plan's `symbol`
 * (i.e. SOL for a SOL trade plan).
 */
export function jupiterPlanFromLevel(opts: {
  direction: TradeDirection;
  kind: 'entry' | 'tp1' | 'tp2' | 'sl';
  baseSymbol: string;
  /** How much of the base asset the level acts on, in whole units. */
  amountBase: number;
}): JupiterSwapPlan | null {
  const base = opts.baseSymbol.toUpperCase();
  if (!MAINNET_MINTS[base]) return null;
  const isOpen = opts.kind === 'entry';
  const isLong = opts.direction === 'long';
  // Long entry buys base with USDC; long exit sells base for USDC.
  // Short flips the sides (open SOL→USDC to short, close USDC→SOL).
  const inputSymbol =
    (isLong && isOpen) || (!isLong && !isOpen) ? 'USDC' : base;
  const outputSymbol = inputSymbol === 'USDC' ? base : 'USDC';
  return {
    inputSymbol,
    outputSymbol,
    amountInWhole: opts.amountBase,
  };
}

/**
 * Return a `https://jup.ag/swap/…` URL for the given swap plan, or
 * null if either mint is unknown or the network isn't mainnet.
 *
 * The `network` arg lets the caller pass the site's payment
 * network so devnet builds surface a disabled button — Jupiter has
 * no devnet deployment, so we never render a jup.ag link on a
 * devnet trade plan (would 404 or execute on the user's real
 * mainnet wallet if they miss the network mismatch).
 */
export function jupiterSwapUrl(
  swap: JupiterSwapPlan,
  network: 'mainnet-beta' | 'devnet' | 'testnet',
): string | null {
  if (network !== 'mainnet-beta') return null;
  const input = MAINNET_MINTS[swap.inputSymbol.toUpperCase()];
  const output = MAINNET_MINTS[swap.outputSymbol.toUpperCase()];
  if (!input || !output) return null;
  const amountRaw = Math.floor(swap.amountInWhole * 10 ** input.decimals);
  if (amountRaw <= 0) return null;
  // Jupiter's terminal accepts INPUT-OUTPUT as a compact path.
  // `inAmount` (raw uint) is what their swap page reads.
  const url = new URL(
    `https://jup.ag/swap/${swap.inputSymbol.toUpperCase()}-${swap.outputSymbol.toUpperCase()}`,
  );
  url.searchParams.set('inAmount', String(amountRaw));
  return url.toString();
}

/**
 * Convenience — check whether a symbol is one Jupiter's terminal
 * will render on mainnet. Used to grey out the "Open Jupiter"
 * button when the plan's base asset isn't in the mint registry.
 */
export function isJupiterSymbolSupported(symbol: string): boolean {
  return MAINNET_MINTS[symbol.toUpperCase()] !== undefined;
}
