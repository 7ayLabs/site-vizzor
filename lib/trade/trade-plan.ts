/**
 * Trade plan — v0.5.2 (Phase 1 of the auto-trade roadmap).
 *
 * A structured trade plan the engine emits alongside its prose
 * response. The site renders it as an in-thread `TradePlanCard`
 * where each level (Entry / TP1 / TP2 / SL) gets:
 *
 *   [Set alert]    → POST /api/alerts, fires when price crosses
 *   [Open Jupiter] → jup.ag deep-link with the swap prefilled
 *
 * That gives the user 90% of the "auto-trade" UX (1-click execute
 * from an alert) without any of the custody/regulatory burden of
 * building a session-vault stack. See
 * docs/rfc/vizzor-engine-v0.5.1.md § "Trade plan" for the engine
 * side of the contract.
 */

export type TradeDirection = 'long' | 'short';

export type TradePlanLevelKind = 'entry' | 'tp1' | 'tp2' | 'sl';

export interface TradePlanLevel {
  kind: TradePlanLevelKind;
  /** USD price the level triggers at. */
  price: number;
  /**
   * Optional fractional delta from entry (0.02 = +2%). The card
   * renders this next to the price so the user can eyeball the
   * risk/reward without doing math.
   */
  deltaFromEntryPct?: number | null;
  /**
   * Percentage of position size to close at this level. Only
   * meaningful for TP1/TP2. Null on entry (100% by definition) and
   * SL (full stop-loss).
   */
  positionPct?: number | null;
}

export interface TradePlan {
  /**
   * Stable id the engine assigns. Used as the key on the site and
   * as the reference id when the site posts follow-up alerts so all
   * four levels group under the same trade on the alerts page.
   */
  plan_id: string;
  symbol: string;
  direction: TradeDirection;
  /**
   * The full ladder — always exactly one `entry`, at most one each
   * of `tp1` / `tp2` / `sl`. Levels are rendered in the order they
   * appear.
   */
  levels: TradePlanLevel[];
  /**
   * The specific asset the user intended to trade (may equal
   * `symbol` for spot, or differ for pair-based instructions). If
   * null the card falls back to `symbol`.
   */
  base_asset?: string | null;
  /**
   * Suggested position size in base units (e.g. 0.5 for 0.5 SOL).
   * Null when the engine doesn't have enough context to size the
   * trade (missing wallet balance snapshot, or the user asked for
   * signal-only).
   */
  size_base?: number | null;
  /**
   * Time horizon the plan is valid for, in hours. The card renders
   * this next to the plan-id so a user opening a chat from days ago
   * doesn't try to act on a stale plan.
   */
  horizon_hours?: number | null;
  /** Engine's confidence in the plan (0-1). Optional. */
  confidence?: number | null;
  /**
   * Timestamp the engine emitted the plan at, in ms epoch.
   */
  issued_at: number;
  /**
   * If the user asked for post-trade wallet forwarding
   * ("send winnings to X"), this is the destination address.
   * Rendered as a footnote on the card so the user remembers what
   * they asked for; the actual transfer is a separate intent minted
   * when TP1/TP2 executes.
   */
  proceeds_to?: string | null;
}

/**
 * Strict shape check for anything claiming to be a TradePlan
 * (server-side normalization + client-side revival). Returns null
 * on any structural mismatch so callers can degrade silently
 * instead of crashing the message stream.
 */
export function parseTradePlan(raw: unknown): TradePlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.plan_id !== 'string' ||
    typeof o.symbol !== 'string' ||
    (o.direction !== 'long' && o.direction !== 'short') ||
    !Array.isArray(o.levels) ||
    typeof o.issued_at !== 'number'
  ) {
    return null;
  }
  const levels: TradePlanLevel[] = [];
  for (const raw of o.levels) {
    if (!raw || typeof raw !== 'object') continue;
    const l = raw as Record<string, unknown>;
    if (
      (l.kind !== 'entry' &&
        l.kind !== 'tp1' &&
        l.kind !== 'tp2' &&
        l.kind !== 'sl') ||
      typeof l.price !== 'number' ||
      !Number.isFinite(l.price)
    ) {
      continue;
    }
    levels.push({
      kind: l.kind,
      price: l.price,
      deltaFromEntryPct:
        typeof l.deltaFromEntryPct === 'number' &&
        Number.isFinite(l.deltaFromEntryPct)
          ? l.deltaFromEntryPct
          : null,
      positionPct:
        typeof l.positionPct === 'number' && Number.isFinite(l.positionPct)
          ? l.positionPct
          : null,
    });
  }
  if (levels.length === 0) return null;
  return {
    plan_id: o.plan_id,
    symbol: o.symbol,
    direction: o.direction,
    levels,
    base_asset: typeof o.base_asset === 'string' ? o.base_asset : null,
    size_base:
      typeof o.size_base === 'number' && Number.isFinite(o.size_base)
        ? o.size_base
        : null,
    horizon_hours:
      typeof o.horizon_hours === 'number' && Number.isFinite(o.horizon_hours)
        ? o.horizon_hours
        : null,
    confidence:
      typeof o.confidence === 'number' && Number.isFinite(o.confidence)
        ? o.confidence
        : null,
    issued_at: o.issued_at,
    proceeds_to: typeof o.proceeds_to === 'string' ? o.proceeds_to : null,
  };
}
