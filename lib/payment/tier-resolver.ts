/**
 * Tier resolver — the single source of truth for "what plan is this
 * wallet on right now?"
 *
 * Replaces the v0.3.0 count-based free-tier gate (`lib/quota.ts`) with
 * a four-state ladder that matches the website's pricing ladder:
 *
 *   - `elite`  → an active Elite subscription (monthly/annual/lifetime).
 *                Unlimited predictions, every feature flag, no daily cap.
 *   - `pro`    → an active Pro subscription (monthly/annual). Unlimited
 *                predictions soft-capped at `proDailyCap()` per UTC day.
 *   - `trial`  → no paid subscription, but inside the 7-day Pro trial
 *                window from `trial_started_at`. Full Pro features at
 *                `trialDailyCap()` per UTC day.
 *   - `free`   → no paid subscription, trial expired (or operator-
 *                killed via `NEXT_PUBLIC_TRIAL_TIER_OVERRIDE=free`).
 *                Predict route refuses with 402; the rest of the site
 *                still works (scanner, security, snapshot).
 *
 * The resolver is the only place that consults `subscriptions` AND
 * `wallet_free_usage` together — call sites get a tagged-union answer
 * with the numbers they need to render the UI (`daysRemaining`,
 * `dailyUsed`, `dailyCap`) without re-querying.
 */

import {
  findActiveSubscriptionByWallet,
  getWalletFreeUsageRow,
  startTrialIfNew,
  type SubscriptionRow,
  type WalletFreeUsageRow,
} from './db';
import {
  freeTrialDays,
  proDailyCap,
  trialDailyCap,
  trialTierOverride,
} from '@/lib/feature-flags';

const DAY_MS = 86_400_000;

export type EffectiveTier =
  | {
      kind: 'elite';
      subscription: SubscriptionRow;
    }
  | {
      kind: 'pro';
      subscription: SubscriptionRow;
      dailyUsed: number;
      dailyCap: number;
    }
  | {
      kind: 'trial';
      trialStartedAt: number;
      trialExpiresAt: number;
      daysRemaining: number;
      dailyUsed: number;
      dailyCap: number;
    }
  | {
      kind: 'free';
      reason: 'never_started' | 'trial_expired' | 'operator_killed';
    };

/**
 * Resolve the effective tier for a wallet. Pure: never writes, never
 * advances time. Use `startTrialIfNew` on the request boundary to
 * stamp the anchor when needed.
 */
export function resolveTier(wallet: string, now: number = Date.now()): EffectiveTier {
  const subscription = findActiveSubscriptionByWallet(wallet, now);
  if (subscription) {
    if (subscription.tier === 'elite' || subscription.tier === 'lifetime') {
      return { kind: 'elite', subscription };
    }
    const usage = getWalletFreeUsageRow(wallet);
    const dailyUsed = usageForToday(usage, now);
    return {
      kind: 'pro',
      subscription,
      dailyUsed,
      dailyCap: proDailyCap(),
    };
  }

  // No paid subscription — check the trial window.
  if (trialTierOverride() === 'free') {
    return { kind: 'free', reason: 'operator_killed' };
  }

  const usage = getWalletFreeUsageRow(wallet);
  if (!usage?.trial_started_at) {
    return { kind: 'free', reason: 'never_started' };
  }

  const windowMs = freeTrialDays() * DAY_MS;
  const trialExpiresAt = usage.trial_started_at + windowMs;
  if (now >= trialExpiresAt) {
    return { kind: 'free', reason: 'trial_expired' };
  }

  const daysRemaining = Math.max(1, Math.ceil((trialExpiresAt - now) / DAY_MS));
  return {
    kind: 'trial',
    trialStartedAt: usage.trial_started_at,
    trialExpiresAt,
    daysRemaining,
    dailyUsed: usageForToday(usage, now),
    dailyCap: trialDailyCap(),
  };
}

/**
 * Stamp the trial anchor + resolve in one call. Convenience for the
 * predict-route entry point: ensures a brand-new wallet's first call
 * transitions from `free:never_started` to `trial` atomically.
 */
export function resolveTierWithTrialStart(
  wallet: string,
  now: number = Date.now(),
): EffectiveTier {
  startTrialIfNew(wallet);
  return resolveTier(wallet, now);
}

/**
 * Read the `daily_used` counter only if its anchor is the current
 * UTC day; stale anchors (yesterday or earlier) read as zero. The
 * `incrementWalletFreeUsage` upsert resets the counter when the
 * write lands; this is just the read-side mirror.
 */
function usageForToday(usage: WalletFreeUsageRow | null, now: number): number {
  if (!usage?.daily_used_at) return 0;
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  return usage.daily_used_at >= dayStart ? usage.daily_used : 0;
}

/** True when the effective tier should be sent to the engine as `pro`. */
export function metadataTierFor(effective: EffectiveTier): 'pro' | 'elite' | 'free' {
  switch (effective.kind) {
    case 'elite':
      return 'elite';
    case 'pro':
    case 'trial':
      return 'pro';
    case 'free':
      return 'free';
  }
}
