'use client';

/**
 * useHealth — SWR hook backing the sidebar status pill.
 *
 * Polls `/api/health` every 30s; rolls back to the previous result on
 * transient errors so the pill doesn't flicker red on a single missed
 * fetch. The endpoint is deliberately cheap (single SELECT + a 30s-
 * cached engine probe) so this polling cadence costs nothing in steady
 * state.
 */

import useSWR from 'swr';

export interface SubsystemHealth {
  ok: boolean;
  detail?: string;
  lastTickAt?: number | null;
  stale?: boolean;
  latencyMs?: number;
  status?: number;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  status: 'healthy' | 'degraded';
  sha: string;
  buildTime: string | null;
  uptime: number;
  timestamp: string;
  subsystems: {
    sqlite: SubsystemHealth;
    watcher: SubsystemHealth;
    engine?: SubsystemHealth;
  };
}

const fetcher = async (url: string): Promise<HealthResponse> => {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<HealthResponse>;
};

export function useHealth() {
  const { data, error, isLoading, mutate } = useSWR<HealthResponse>(
    '/api/health',
    fetcher,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
      shouldRetryOnError: false,
    },
  );

  return { data, error, isLoading, mutate };
}
