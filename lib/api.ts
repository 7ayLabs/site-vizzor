/**
 * Live data layer for vizzor.ai.
 *
 * Reads from the public read-only endpoints at NEXT_PUBLIC_VIZZOR_API_URL
 * (defaults to `https://api.vizzor.ai`). When the API is unreachable or
 * returns a 5xx, hooks transparently fall back to the build-time snapshot
 * loaded via `@/lib/snapshot`. Visitors never see "broken numbers."
 *
 * Hooks are designed to be drop-in replacements for the snapshot calls
 * already used by Hero, ConvergenceShow, ReceiptsScorecard, etc. Server
 * components keep using `getTicker()` / `getRecentPredictions()` for the
 * initial render; client components opt into live refresh via these hooks.
 */

'use client';

import useSWR, { type SWRConfiguration } from 'swr';
import type { Prediction, TickerEntry, TrackerWR } from './types';
import {
  getRecentPredictions as snapshotPredictions,
  getTicker as snapshotTicker,
  getTrackerWR as snapshotTrackerWR,
  getLast24h as snapshotLast24h,
  type Last24h,
} from './snapshot';

const API_BASE =
  process.env.NEXT_PUBLIC_VIZZOR_API_URL ?? 'https://api.vizzor.ai';

const FETCH_TIMEOUT_MS = 5_000;

async function fetcher<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

const SWR_DEFAULTS: SWRConfiguration = {
  // Refresh when the tab regains focus or the network comes back online,
  // so a back-button revisit / iOS bfcache restore re-pulls live prices
  // instead of showing whatever was on screen when the user navigated away.
  // The `/api/ticker` route is already cached upstream (engine + 15s
  // aggregator window), so a focus-fired revalidation is essentially free.
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  keepPreviousData: true,
  // We do want a short retry on transient errors so a single flaky fetch
  // doesn't pin the ticker to the snapshot for 30s. Two retries is enough
  // to ride out a brief edge hiccup without hammering the engine.
  shouldRetryOnError: true,
  errorRetryCount: 2,
  errorRetryInterval: 1_000,
};

export interface LiveResult<T> {
  data: T;
  isLive: boolean;
  isLoading: boolean;
}

function withFallback<T>(
  swrResult: { data: T | undefined; isLoading: boolean; error: unknown },
  fallback: T,
): LiveResult<T> {
  const live = swrResult.data !== undefined && !swrResult.error;
  return {
    data: live ? (swrResult.data as T) : fallback,
    isLive: live,
    isLoading: swrResult.isLoading,
  };
}

/* -----------------------------------------------------------------------
 * Public hooks
 * ----------------------------------------------------------------------- */

export function useTicker(refreshIntervalMs = 15_000): LiveResult<TickerEntry[]> {
  // Internal proxy to the Vizzor engine's `/v1/market/prices` (see
  // `app/api/ticker/route.ts`) — same Binance-backed prices the AI
  // sees. 15s matches the engine's aggregator cache, so polling more
  // often would just hit a warm cache (wasted bandwidth, no fresher
  // data); polling less often makes the widget drift away from what
  // the assistant quotes in the same turn.
  const swr = useSWR<TickerEntry[]>(
    '/api/ticker',
    fetcher,
    { ...SWR_DEFAULTS, refreshInterval: refreshIntervalMs },
  );
  return withFallback(swr, snapshotTicker());
}

/**
 * useExtraTickers — ad-hoc price lookup for symbols beyond the
 * default TOP_20 the standard `useTicker` covers. The chat shell uses
 * this so the inline ticker chip on a Vizzor response works for any
 * coin the user asks about (DASH, LINK, AVAX, …) — not just the curated
 * top-20 set. Pass an EMPTY array (or nothing) to skip the fetch and
 * keep network traffic to zero on threads that only touch top-20.
 *
 * The route returns `[]` for symbols the upstream engine doesn't
 * recognize, so the chip degrades to "no chip" cleanly instead of
 * lying about a price.
 */
export function useExtraTickers(
  symbols: ReadonlyArray<string>,
  refreshIntervalMs = 30_000,
): TickerEntry[] {
  // Stable cache key — sorted CSV so two callers asking for the same
  // set hit the same SWR row regardless of input order.
  const key =
    symbols.length === 0
      ? null
      : `/api/ticker?symbols=${[...new Set(symbols.map((s) => s.toUpperCase()))]
          .sort()
          .join(',')}`;
  const { data } = useSWR<TickerEntry[]>(
    key,
    fetcher,
    { ...SWR_DEFAULTS, refreshInterval: refreshIntervalMs },
  );
  return data ?? [];
}

export function useTrackerWR(refreshIntervalMs = 60_000): LiveResult<TrackerWR> {
  const swr = useSWR<TrackerWR>(
    `${API_BASE}/v1/site/tracker-wr`,
    fetcher,
    { ...SWR_DEFAULTS, refreshInterval: refreshIntervalMs },
  );
  return withFallback(swr, snapshotTrackerWR());
}

export function useLast24h(refreshIntervalMs = 60_000): LiveResult<Last24h> {
  const swr = useSWR<Last24h>(
    `${API_BASE}/v1/site/last-24h`,
    fetcher,
    { ...SWR_DEFAULTS, refreshInterval: refreshIntervalMs },
  );
  return withFallback(swr, snapshotLast24h());
}

interface RecentPredictionsParams {
  limit?: number;
  tier?: Prediction['tier'];
  outcome?: Prediction['outcome'];
  refreshIntervalMs?: number;
}

export function useRecentPredictions(
  params: RecentPredictionsParams = {},
): LiveResult<Prediction[]> {
  const { limit, tier, outcome, refreshIntervalMs = 60_000 } = params;
  const search = new URLSearchParams();
  if (limit) search.set('limit', String(limit));
  if (tier) search.set('tier', tier);
  if (outcome) search.set('outcome', outcome);
  const url = `${API_BASE}/v1/site/recent-predictions${search.size ? `?${search}` : ''}`;

  const swr = useSWR<Prediction[]>(url, fetcher, {
    ...SWR_DEFAULTS,
    refreshInterval: refreshIntervalMs,
  });
  return withFallback(swr, snapshotPredictions({ limit, tier, outcome }));
}

export function usePrediction(
  id: string | null,
  refreshIntervalMs = 0,
): LiveResult<Prediction | null> {
  const swr = useSWR<Prediction>(
    id ? `${API_BASE}/v1/site/prediction/${id}` : null,
    fetcher,
    { ...SWR_DEFAULTS, refreshInterval: refreshIntervalMs },
  );
  return withFallback<Prediction | null>(
    swr,
    id ? snapshotPredictions().find((p) => p.id === id) ?? null : null,
  );
}
