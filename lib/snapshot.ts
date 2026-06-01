/**
 * Build-time snapshot loader. Mirrors the live `api.vizzor.ai/v1/site/*`
 * response shape. Used pre-Phase-7 as the only source, and post-Phase-7 as
 * the fallback when the live API is unreachable.
 */

import seed from '@/data/snapshot.json';
import type { Prediction, TickerEntry, TrackerWR } from './types';

export interface CalibrationBanner {
  version: string;
  stage: string;
  target: number;
  note: string;
}

export interface Last24h {
  hits: number;
  misses: number;
  neutrals: number;
  pending: number;
  decisiveWR: number;
}

interface ExtendedTrackerWR extends TrackerWR {
  last24h: Last24h;
}

interface Snapshot {
  _seed?: boolean;
  asOf: string;
  calibrationBanner: CalibrationBanner;
  ticker: TickerEntry[];
  trackerWR: ExtendedTrackerWR;
  recentPredictions: Prediction[];
}

export function getSnapshot(): Snapshot {
  return seed as unknown as Snapshot;
}

export function getTicker(): TickerEntry[] {
  return getSnapshot().ticker;
}

export function getTrackerWR(): ExtendedTrackerWR {
  return getSnapshot().trackerWR;
}

export function getLast24h(): Last24h {
  return getSnapshot().trackerWR.last24h;
}

export function getCalibrationBanner(): CalibrationBanner {
  return getSnapshot().calibrationBanner;
}

export function getRecentPredictions(opts?: {
  limit?: number;
  tier?: Prediction['tier'];
  outcome?: Prediction['outcome'];
}): Prediction[] {
  const all = getSnapshot().recentPredictions;
  const filtered = all.filter((p) => {
    if (opts?.tier && p.tier !== opts.tier) return false;
    if (opts?.outcome && p.outcome !== opts.outcome) return false;
    return true;
  });
  return opts?.limit ? filtered.slice(0, opts.limit) : filtered;
}

export function getPrediction(id: string): Prediction | null {
  const found = getSnapshot().recentPredictions.find((p) => p.id === id);
  return found ?? null;
}
