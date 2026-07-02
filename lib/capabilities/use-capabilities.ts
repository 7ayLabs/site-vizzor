'use client';

/**
 * SWR hook for the wallet's capability preferences.
 *
 * Consumed by:
 *   - PredictShell → composer tray (which icons are enabled vs locked)
 *   - Settings → capabilities page (full CRUD)
 *
 * The GET endpoint returns everything the settings page needs; the
 * tray uses a strict subset. Both surfaces subscribe to the same SWR
 * key so a settings-side toggle rehydrates the tray on the next
 * revalidate cycle without a page reload.
 *
 * Failure mode: if the fetch errors (network, 500, or unauthenticated),
 * the hook returns the safe closed state — nothing enabled, tier
 * locked. This is the same "fail closed" pattern the rate limiter and
 * SIWS gate use elsewhere.
 */

import useSWR from 'swr';
import {
  ALL_CAP_IDS,
  DEFAULT_SPEND_CAPS_USD,
  type CapId,
} from './intent';

export interface RecentIntentSummary {
  intent_id: string;
  kind: CapId;
  network: string;
  symbol: string | null;
  amount: string | null;
  status: string;
  tx_hash: string | null;
  created_at: number;
}

export interface CapabilitiesResponse {
  enabled: CapId[];
  spend_caps: Record<CapId, number>;
  spend_used_today: Record<CapId, number>;
  tos_version: number | null;
  tos_accepted_at: number | null;
  current_tos_version: number;
  /** Free tier: whole tray is locked regardless of enabled set. */
  tier_locked: boolean;
  recent_intents: RecentIntentSummary[];
}

const CAPABILITIES_KEY = '/api/capabilities/enabled';

async function fetcher(url: string): Promise<CapabilitiesResponse> {
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`capabilities_fetch_${res.status}`);
  return (await res.json()) as CapabilitiesResponse;
}

const SAFE_DEFAULT: CapabilitiesResponse = {
  enabled: [],
  spend_caps: { ...DEFAULT_SPEND_CAPS_USD },
  spend_used_today: { transfer: 0, payment: 0 },
  tos_version: null,
  tos_accepted_at: null,
  current_tos_version: 1,
  tier_locked: true,
  recent_intents: [],
};

export function useCapabilities(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  const swr = useSWR<CapabilitiesResponse>(
    enabled ? CAPABILITIES_KEY : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 15_000,
      fallbackData: SAFE_DEFAULT,
      shouldRetryOnError: false,
    },
  );

  const data = swr.data ?? SAFE_DEFAULT;
  const enabledSet: ReadonlySet<CapId> = new Set(data.enabled);
  const isTosAccepted = data.tos_version === data.current_tos_version;

  return {
    ...swr,
    data,
    enabledSet,
    tierLocked: data.tier_locked,
    isTosAccepted,
    allCaps: ALL_CAP_IDS,
    /** Convenience: revalidate the SWR after a mutation (PATCH). */
    refresh: swr.mutate,
  };
}

export { CAPABILITIES_KEY };
