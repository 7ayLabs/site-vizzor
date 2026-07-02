/**
 * Capability command syntax — inline prompt DSL.
 *
 * v0.5.0 no longer surfaces a draft form modal for capability
 * intents. Instead the tray icons INSERT a command line into the
 * composer textarea and let the user fill in the fields inline
 * exactly like any other prompt token. On submit the composer
 * regex-matches these lines and mints the pending intent via
 * /api/capabilities/create-intent BEFORE dispatching to the engine.
 *
 * Grammar (minimalist — reads like natural chat, no slash prefix):
 *
 *   send 0.1 SOL → <recipient>       (transfer)
 *   pay  0.1 SOL → <recipient>       (scheduled payment)
 *
 * The parser accepts either the arrow character `→` (what the tray
 * inserts) or the word `to` (what a user is most likely to type on
 * a keyboard). Amount is a decimal string, symbol is uppercase
 * A–Z 0–9, recipient is 16–128 base58/base64url characters. Case is
 * ignored on the keyword so `Send`, `SEND`, `send` all work.
 *
 * A single prompt may contain at most one command. If two appear
 * the first wins — signing two intents against a single wallet
 * prompt is ambiguous UX.
 */

import type { CapId } from './intent';

/** The literal user-facing keyword for each capability. */
export const COMMAND_KEYWORD: Record<CapId, string> = {
  transfer: 'send',
  payment: 'pay',
};

/** Inverse lookup: `pay` → `payment`, `auto` → `autonomous`, etc. */
const KEYWORD_TO_CAP: Record<string, CapId> = (() => {
  const m: Record<string, CapId> = {};
  for (const [cap, kw] of Object.entries(COMMAND_KEYWORD) as [CapId, string][]) {
    m[kw] = cap;
  }
  return m;
})();

/**
 * Placeholder token retained for the overlay parser + backward
 * compat with any legacy prompts. New templates below don't embed
 * this — instead the tray inserts a trailing arrow + space and
 * drops the caret at the end so the user types the recipient
 * directly, no placeholder to delete.
 */
export const RECIPIENT_PLACEHOLDER = '<recipient>';

/** Default symbol when the caller doesn't supply one. */
export const DEFAULT_TEMPLATE_SYMBOL = 'SOL';

/**
 * Default amount seeded into the template. Kept small enough that
 * an accidental send costs cents, not dollars — the user is expected
 * to edit it anyway.
 */
export const DEFAULT_TEMPLATE_AMOUNT = '0.1';

/**
 * Build the inline command template for a capability + symbol. The
 * carousel selection drives the symbol: `send 0.1 BTC → ` for BTC,
 * `send 0.1 ETH → ` for ETH, etc. Trailing space so the caret sits
 * immediately before the recipient address.
 */
export function buildCommandTemplate(
  cap: CapId,
  symbol: string = DEFAULT_TEMPLATE_SYMBOL,
  amount: string = DEFAULT_TEMPLATE_AMOUNT,
): string {
  const kw = COMMAND_KEYWORD[cap];
  return `${kw} ${amount} ${symbol.toUpperCase()} → `;
}

/**
 * Legacy static templates. Kept for tests + backward compat but new
 * callers should use `buildCommandTemplate(cap, symbol)` so the
 * carousel-selected ticker drives the symbol.
 * @deprecated use `buildCommandTemplate` for carousel-aware inserts
 */
export const COMMAND_TEMPLATE: Record<CapId, string> = {
  transfer: buildCommandTemplate('transfer'),
  payment: buildCommandTemplate('payment'),
};

/**
 * Character indexes of the first placeholder in each template so the
 * shell can select-highlight it right after insertion — same UX as
 * a snippet in VS Code where you land in the first tabstop.
 */
/**
 * Where the caret lands after the tray inserts the template. With
 * the placeholder-less template, this is always the very end of the
 * string — the user's next keystroke starts the recipient address.
 */
export const TEMPLATE_CARET_POSITION: Record<CapId, number> = (() => {
  const m: Record<CapId, number> = {} as never;
  for (const cap of Object.keys(COMMAND_TEMPLATE) as CapId[]) {
    m[cap] = COMMAND_TEMPLATE[cap].length;
  }
  return m;
})();

/**
 * @deprecated retained for the overlay parser + existing tests.
 * Equivalent to a caret-at-end range now that there's no explicit
 * placeholder in the template.
 */
export const TEMPLATE_PLACEHOLDER_RANGE: Record<
  CapId,
  { start: number; end: number }
> = (() => {
  const m: Record<CapId, { start: number; end: number }> = {} as never;
  for (const cap of Object.keys(COMMAND_TEMPLATE) as CapId[]) {
    const t = COMMAND_TEMPLATE[cap];
    m[cap] = { start: t.length, end: t.length };
  }
  return m;
})();

/**
 * Regex covers the two shipping keywords, a decimal amount, uppercase
 * ticker symbol, and a base58/base64url-ish address. Separator can
 * be either the arrow character `→` (what the tray inserts) or the
 * word `to` (what a user types). Case-insensitive on the keyword.
 * All four fields are required — a bare "send" without a target
 * doesn't hijack the prompt.
 */
const COMMAND_RE =
  /\b(send|pay)\s+(\d+(?:\.\d{1,18})?)\s+([A-Z0-9]{1,16})\s+(?:→|to)\s+([a-zA-Z0-9_-]{16,128})/i;

export interface ParsedCommand {
  capability: CapId;
  amount: string;
  symbol: string;
  toAddr: string;
  /** Where in the original text the command started + ended. */
  matchStart: number;
  matchEnd: number;
  /** The full literal command substring. Useful for stripping the
   *  command from the prompt before it goes to the engine. */
  raw: string;
}

/**
 * Parse the first capability command from a prompt. Case-sensitive
 * on the keyword (the tray inserts lowercase so the user sees the
 * canonical form). Returns null when nothing matches — the composer
 * then dispatches the prompt to /predict unchanged.
 */
export function parseCommand(text: string): ParsedCommand | null {
  const m = COMMAND_RE.exec(text);
  if (!m) return null;
  const keyword = (m[1] ?? '').toLowerCase();
  const capability = KEYWORD_TO_CAP[keyword];
  if (!capability) return null;
  return {
    capability,
    amount: m[2] ?? '',
    symbol: (m[3] ?? '').toUpperCase(),
    toAddr: m[4] ?? '',
    matchStart: m.index,
    matchEnd: m.index + m[0].length,
    raw: m[0],
  };
}

/**
 * Detect a partial command — user has typed the keyword but hasn't
 * filled in every field yet. The composer uses this to color the
 * command prefix in the overlay before the full match lands.
 */
export function detectPartialCommand(text: string): CapId | null {
  const m = /\b(send|pay)\b/i.exec(text);
  if (!m) return null;
  const kw = (m[1] ?? '').toLowerCase();
  return KEYWORD_TO_CAP[kw] ?? null;
}

/**
 * Strip a matched command from the prompt so the residue can still
 * flow to /predict as regular chat. The parser writes the intent
 * server-side; the leftover text becomes the message body the engine
 * sees. Whitespace around the removed segment is collapsed.
 */
export function stripCommand(text: string, parsed: ParsedCommand): string {
  const before = text.slice(0, parsed.matchStart);
  const after = text.slice(parsed.matchEnd);
  return `${before}${after}`.replace(/\s{2,}/g, ' ').trim();
}
