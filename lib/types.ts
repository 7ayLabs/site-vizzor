/**
 * Shared types for vizzor.ai. Mirrors the shape of the Vizzor product's
 * chronovisor_predictions rows and SignalSnapshot trigger data. The site
 * never mutates these — they come read-only from api.vizzor.ai/v1/site/*.
 */

export type Direction = 'up' | 'down' | 'sideways';

export type Tier = 'high-conviction' | 'whale-confirmed' | 'tracked' | 'advisory';

export type Outcome = 'hit' | 'miss' | 'neutral' | 'pending';

export type Horizon =
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '6h'
  | '1d'
  | '7d'
  | '30d'
  | '90d'
  | '1y'
  | (string & {});

export type Chain =
  | 'ethereum'
  | 'polygon'
  | 'arbitrum'
  | 'optimism'
  | 'base'
  | 'bsc'
  | 'avalanche'
  | 'solana'
  | 'sui'
  | 'aptos'
  | 'ton';

export type SignalFamily =
  | 'onChain'
  | 'mlEnsemble'
  | 'predictionMarkets'
  | 'socialNarrative'
  | 'patternMatch'
  | 'logicRules';

export interface SignalContribution {
  family: SignalFamily;
  cf: number; // [-1, 1]
  direction: Direction;
  meta?: Record<string, number | string>;
}

export interface TriggerSnapshot {
  vizzorTa: { vote: -1 | 0 | 1; signals: SignalContribution[] };
  smc: { vote: -1 | 0 | 1; details?: string };
  ict: { vote: -1 | 0 | 1; details?: string };
  flattenedReason?: string;
}

export interface PriceTarget {
  bull: number;
  base: number;
  bear: number;
}

export interface Prediction {
  id: string;
  symbol: string;
  chain?: Chain;
  horizon: Horizon;
  direction: Direction;
  confidence: number; // [0, 1]
  tier: Tier;
  emittedAt: string; // ISO 8601
  resolvedAt?: string;
  outcome?: Outcome;
  entryPrice: number;
  predictedPrice: number;
  targets?: PriceTarget;
  actualPrice?: number;
  triggerSnapshot?: TriggerSnapshot;
}

export interface TickerEntry {
  symbol: string;
  price: number;
  changePct: number; // [-1, 1] decimal
  source?: string;
}

export interface TrackerWR {
  aggregate: { wr: number; samples: number; asOf: string };
  byTier: Record<Tier, { wr: number; samples: number }>;
  byHorizon: Record<string, { wr: number; samples: number }>;
}

/**
 * Alert lifecycle status. Mirrors the engine's bot-side semantics:
 *
 *   armed       — waiting for the trigger condition (price hit, etc.).
 *   triggered   — fired, notification sent, outcome not yet resolved.
 *   resolved    — fully closed (with hit/miss outcome on the parent
 *                 prediction or a manual user resolution).
 *   cancelled   — armed alert disarmed by the user before firing.
 */
export type AlertStatus = 'armed' | 'triggered' | 'resolved' | 'cancelled';

/**
 * Type of trigger threshold the engine armed for the user. Currently
 * the engine auto-arms one row per `entry`, `tp1`, `tp2`, `sl` whenever
 * the predictor emits a trade plan; `custom` is the slot for manually
 * armed alerts via the Telegram bot's `/alert SYMBOL PRICE` command.
 */
export type AlertKind = 'entry' | 'tp1' | 'tp2' | 'sl' | 'custom';

export interface AlertRow {
  id: string;
  symbol: string;
  chain?: Chain;
  /** Direction the trigger fires on — `up` = price crosses above,
   *  `down` = price crosses below. */
  direction: Direction;
  /** Trigger price in USD. */
  price: number;
  kind: AlertKind;
  status: AlertStatus;
  armedAt: string; // ISO 8601
  triggeredAt?: string;
  /** Spot price at the moment the rule fired. Used by the web surface
   *  to render an authoritative "fired @ $X" stamp without re-querying
   *  the ticker. */
  triggeredPrice?: number;
  resolvedAt?: string;
  /** When the alert was auto-armed from a prediction's trade plan,
   *  this links back to the parent prediction so the UI can show the
   *  full context (confidence, signal breakdown). */
  predictionId?: string;
  /** Trade-plan context (populated for rows armed by the engine's
   *  `set_trade_plan_alerts` tool). Lets the UI render leverage +
   *  P/L% per row against the parent entry. */
  entryPrice?: number;
  leverage?: number;
  planId?: string;
  /** Direction of the parent trade plan — 'long' bets price up, 'short'
   *  bets price down. Used by the P/L% computation in the UI. */
  tradeDirection?: 'long' | 'short';
}
