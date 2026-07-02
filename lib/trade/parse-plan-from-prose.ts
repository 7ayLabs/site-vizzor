/**
 * Client-side fallback parser: extract TradePlan(s) from an assistant
 * bubble's prose text.
 *
 * Why this exists
 * ───────────────
 * Phase 1 of the auto-trade roadmap has two layers:
 *
 *   (a) Engine emits `event: trade_plan` alongside its prose → site
 *       renders a TradePlanCard from the structured payload.
 *       That's the authoritative path (see docs/rfc/vizzor-engine-v0.5.1.md
 *       § 4b). Doesn't ship until the engine PR does.
 *
 *   (b) This file — the site scans the assistant's prose for the
 *       Entry / TP1 / TP2 / SL pattern the engine already writes and
 *       synthesizes a TradePlan client-side, so cards render on
 *       existing engine responses THE MOMENT the site deploys.
 *
 * The parser is deliberately conservative: it looks for the exact
 * "Trade plan" section shape the engine uses (a heading followed by
 * a table of labeled prices) and skips anything ambiguous. False
 * positives are worse than misses because a card rendered on random
 * prices would tell the user "these are actionable" when they're
 * not. When the engine ships (a), it wins over (b) via plan_id
 * dedupe.
 *
 * Handles:
 *   - Single-plan responses (one LONG or SHORT plan)
 *   - Multi-plan responses (LONG primary + SHORT conditional, etc.)
 *   - Spanish + English label variants (Entrada/Entry, Stop/SL)
 *   - Optional Proceeds-to wallet section
 */

import type { TradePlan, TradePlanLevel } from './trade-plan';

const PRICE_RE = /\$?\s*([0-9]+(?:[.,][0-9]+)?)/;

/**
 * Match one plan block by its heading. The engine's format is:
 *   🎯 TRADE PLAN — SOL LONG (…)      (single-plan)
 *   🎯 TRADE PLAN 1 — LONG (Primario)  (multi-plan)
 * The `direction` group is required so bare "Trade plan" mentions
 * inside prose (not a real plan header) don't false-match.
 */
const PLAN_HEADING_RE =
  /(?:trade\s*plan|plan\s*de\s*trade)\s*(?:\d+)?\s*[—–\-:]?\s*(?:[A-Z0-9]{1,16}\s+)?(long|short)/gi;

/**
 * Level line patterns — the engine writes each level on its own line
 * with a label + price. Tolerant of bold markers (`**$77.71**`),
 * whitespace variance, and the Spanish/English label pair.
 *
 *   ↳ Entry: **$77.71**  (or "Entrada:")
 *   ↳ TP1: **$79.26** …
 *   ↳ TP2: **$80.82** …
 *   ↳ SL: **$76.16** …  (or "Stop:")
 */
const LEVEL_RES: Record<TradePlanLevel['kind'], RegExp> = {
  entry: /\b(?:entry|entrada)[\s:]*\*{0,2}\$?\s*([0-9]+(?:[.,][0-9]+)?)/i,
  tp1: /\bTP\s*1[\s:]*\*{0,2}\$?\s*([0-9]+(?:[.,][0-9]+)?)/i,
  tp2: /\bTP\s*2[\s:]*\*{0,2}\$?\s*([0-9]+(?:[.,][0-9]+)?)/i,
  sl: /\b(?:sl|stop)[\s:]*\*{0,2}\$?\s*([0-9]+(?:[.,][0-9]+)?)/i,
};

/** Base58 wallet address as a self-contained token, min 32 chars. */
const WALLET_RE = /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/;

/** Symbol next to the plan heading (e.g. "TRADE PLAN — SOL LONG"). */
const SYMBOL_NEAR_HEADING_RE =
  /(?:trade\s*plan|plan\s*de\s*trade)\s*(?:\d+)?\s*[—–\-:]?\s*([A-Z0-9]{2,16})\s+(?:long|short)/i;

/**
 * Extract one or more trade plans from a chunk of assistant prose.
 * Returns an empty array when nothing matches — callers should treat
 * that as "no plan in this turn" and simply not render a card.
 *
 * `messageId` seeds a stable plan_id per parsed plan so React state
 * dedupes on re-render (same message → same plan_id every time).
 * `issuedAt` should be the moment the message finished streaming.
 */
export function parseTradePlansFromProse(opts: {
  text: string;
  messageId: string;
  issuedAt: number;
  /** Fallback symbol when the plan heading doesn't include one — usually the last ticker the user pilled in the composer. */
  fallbackSymbol?: string | null;
}): TradePlan[] {
  const { text, messageId, issuedAt } = opts;
  if (!text || text.length < 40) return [];

  const plans: TradePlan[] = [];
  const proceedsTo = extractProceedsTo(text);
  // Split the message on plan headings so multi-plan responses
  // (LONG primary + SHORT conditional) parse into two plans instead
  // of collapsing into one.
  const segments = splitOnPlanHeadings(text);

  segments.forEach((segment, idx) => {
    const direction = segment.direction;
    if (!direction) return;
    const body = segment.body;
    const levels: TradePlanLevel[] = [];
    let entryPrice: number | null = null;

    (['entry', 'tp1', 'tp2', 'sl'] as const).forEach((kind) => {
      const match = LEVEL_RES[kind].exec(body);
      if (!match) return;
      const price = numFromMatch(match[1]);
      if (price === null) return;
      if (kind === 'entry') entryPrice = price;
      const level: TradePlanLevel = { kind, price };
      if (entryPrice !== null && kind !== 'entry') {
        level.deltaFromEntryPct = (price - entryPrice) / entryPrice;
      }
      levels.push(level);
    });

    // A plan needs at LEAST an entry + one exit-side level (TP or SL).
    // Otherwise it's likely a fragment of prose that just mentioned a
    // number after "Entry:" without a follow-up. Skip.
    const hasEntry = levels.some((l) => l.kind === 'entry');
    const hasExit = levels.some(
      (l) => l.kind === 'tp1' || l.kind === 'tp2' || l.kind === 'sl',
    );
    if (!hasEntry || !hasExit) return;

    const symbol =
      SYMBOL_NEAR_HEADING_RE.exec(segment.heading)?.[1] ??
      opts.fallbackSymbol ??
      'SOL';

    plans.push({
      plan_id: `plan_prose_${messageId}_${idx}`,
      symbol: symbol.toUpperCase(),
      direction,
      levels,
      base_asset: symbol.toUpperCase(),
      size_base: null, // engine only — prose doesn't reliably encode size
      horizon_hours: null,
      confidence: null,
      issued_at: issuedAt,
      proceeds_to: proceedsTo,
    });
  });

  return plans;
}

interface PlanSegment {
  heading: string;
  body: string;
  direction: 'long' | 'short' | null;
}

/**
 * Slice the message into one segment per plan heading. First segment
 * (before any heading) is discarded — the plan is defined by what
 * comes AFTER the heading up to the next one or end-of-message.
 */
function splitOnPlanHeadings(text: string): PlanSegment[] {
  const headings: Array<{ index: number; direction: 'long' | 'short'; raw: string }> =
    [];
  PLAN_HEADING_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLAN_HEADING_RE.exec(text)) !== null) {
    const raw = match[0];
    const direction = (match[1] ?? '').toLowerCase() as 'long' | 'short';
    if (direction !== 'long' && direction !== 'short') continue;
    headings.push({ index: match.index, direction, raw });
  }
  if (headings.length === 0) return [];
  return headings.map((h, i) => {
    const start = h.index;
    const end = i + 1 < headings.length ? headings[i + 1]!.index : text.length;
    return {
      heading: h.raw,
      body: text.slice(start, end),
      direction: h.direction,
    };
  });
}

/**
 * "envía las ganancias a `<wallet>`" / "send winnings to <wallet>".
 * Finds the wallet-shaped token in the neighborhood of the proceeds
 * language (or, failing that, the last wallet-shaped token in the
 * message). Nulls out when nothing looks like one.
 */
function extractProceedsTo(text: string): string | null {
  const idx = text.search(
    /(?:envía|envia|manda|send).{0,60}(?:ganancias?|winnings?|profits?|beneficios?)/i,
  );
  if (idx >= 0) {
    const window = text.slice(idx, idx + 400);
    const m = WALLET_RE.exec(window);
    if (m) return m[1] ?? null;
  }
  // Fallback: last wallet-shaped token in the whole message.
  const all = [...text.matchAll(new RegExp(WALLET_RE, 'g'))];
  if (all.length === 0) return null;
  return all[all.length - 1]?.[1] ?? null;
}

function numFromMatch(raw: string | undefined): number | null {
  if (!raw) return null;
  // Handle "1.234,56" (Spanish) → 1234.56 by normalizing separators.
  const cleaned = raw.replace(/,/g, '.');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}
