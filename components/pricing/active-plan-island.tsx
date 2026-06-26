'use client';

/**
 * ActivePlanIsland — client boundary that fetches /api/quota once and
 * exposes the connected wallet's active plan (subscription + trial
 * state) to every child via React context.
 *
 * /pricing is otherwise a fully-static server component; we wrap only
 * the tier-card column in this island so the initial paint stays
 * server-rendered and only the CTA + badge slots hydrate to consume
 * the context. Pattern mirrors `lifetime-promo-island.tsx`.
 *
 * Refresh cadence is 12s — matches the auth-session SWR cadence
 * elsewhere in the shell so a payment confirmed at /pay reflects on
 * /pricing within one tick of returning to the page.
 *
 * Failure / unauthenticated default state is "free, no subscription,
 * no trial". Consumers should render their default CTA in that case —
 * never block a payment flow on SWR / engine availability.
 */

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import useSWR from 'swr';

type TierKey = 'free' | 'pro' | 'elite';
type Cadence = 'monthly' | 'annual' | 'lifetime';
type QuotaTier = 'free' | 'trial' | 'pro' | 'elite';

interface QuotaResponse {
  connected?: boolean;
  tier?: QuotaTier;
  trial?: { daysRemaining?: number } | null;
  subscribed?: boolean;
  subscription?: {
    tier?: 'pro' | 'elite';
    cadence?: Cadence;
    expiresAt?: number | null;
  } | null;
}

export interface ActivePlanState {
  /** True only on the very first render before SWR has resolved. */
  isLoading: boolean;
  /** True once the wallet has a live session. */
  isConnected: boolean;
  /** Trial-window flag. The user has Pro-equivalent access but no row
   *  in the subscriptions table. */
  isTrial: boolean;
  trialDaysRemaining: number;
  /** Active paid subscription, or null. */
  subscription: {
    tier: 'pro' | 'elite';
    cadence: Cadence;
    /** Convenience: `expiresAt === null` OR `cadence === 'lifetime'`. */
    isLifetime: boolean;
  } | null;
}

const DEFAULT_STATE: ActivePlanState = {
  isLoading: true,
  isConnected: false,
  isTrial: false,
  trialDaysRemaining: 0,
  subscription: null,
};

const Ctx = createContext<ActivePlanState>(DEFAULT_STATE);

const fetcher = async (url: string): Promise<QuotaResponse> => {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<QuotaResponse>;
};

export function ActivePlanIsland({ children }: { children: ReactNode }) {
  const { data, isLoading } = useSWR<QuotaResponse>('/api/quota', fetcher, {
    refreshInterval: 12_000,
    revalidateOnFocus: false,
    keepPreviousData: true,
    shouldRetryOnError: false,
  });

  const value = useMemo<ActivePlanState>(() => {
    if (!data) {
      return { ...DEFAULT_STATE, isLoading };
    }
    const sub = data.subscription ?? null;
    return {
      isLoading: false,
      isConnected: data.connected === true,
      isTrial: data.tier === 'trial',
      trialDaysRemaining: data.trial?.daysRemaining ?? 0,
      subscription:
        sub && sub.tier && sub.cadence
          ? {
              tier: sub.tier,
              cadence: sub.cadence,
              isLifetime:
                sub.expiresAt === null || sub.cadence === 'lifetime',
            }
          : null,
    };
  }, [data, isLoading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActivePlan(): ActivePlanState {
  return useContext(Ctx);
}

/**
 * How a tier card's primary CTA should relate to the user's active
 * plan.
 *
 *   `current`         — the card matches the wallet's active sub
 *                       (same tier + same cadence). Disable + relabel.
 *   `coveredByHigher` — the card's tier is below the wallet's tier
 *                       (e.g. user is on Elite, viewing Pro card).
 *                       Disable + show "Included in Elite".
 *   `null`            — render the default CTA (default for everyone
 *                       except a current subscriber).
 */
export type ActiveMatch = 'current' | 'coveredByHigher' | null;

export function useActiveMatchFor(
  cardTier: TierKey,
  cardCadence: Cadence,
): ActiveMatch {
  const { subscription } = useActivePlan();
  if (!subscription) return null;
  if (cardTier === 'free') return null; // never gate the free CTA
  if (subscription.tier === cardTier && subscription.cadence === cardCadence) {
    return 'current';
  }
  if (subscription.tier === 'elite' && cardTier === 'pro') {
    return 'coveredByHigher';
  }
  return null;
}
