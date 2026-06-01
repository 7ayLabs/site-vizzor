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
