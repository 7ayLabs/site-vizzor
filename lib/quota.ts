/**
 * Quota state — thin client-facing view of the tier resolver.
 *
 * v0.3.0 → v0.3.2 shift: the legacy count-based gate ("7 free runs
 * per wallet forever") was replaced by a 7-day Pro trial with a
 * per-day cap (`lib/payment/tier-resolver.ts`). This module exists
 * now only to project the resolver's discriminated union into the
 * flat `QuotaState` shape the client SWR hooks already consume —
 * pragma-equivalent of a view.
 *
 * The legacy fields (`used`, `limit`, `remaining`, `exhausted`) are
 * preserved for one release so any pre-v0.3.2 client bundles loaded
 * from disk cache don't crash. They mirror the new fields onto the
 * old contract:
 *
 *   used      = daily counter today
 *   limit     = today's cap (trial=10, pro=1000, elite=999999)
 *   remaining = limit - used
 *   exhausted = true iff the wallet is in the `free` tier
 *
 * New callers should read `tier` and `trial` directly.
 */

import {
  resolveTierWithTrialStart,
  type EffectiveTier,
} from './payment/tier-resolver';

export interface QuotaState {
  /** Discriminated tier: `elite | pro | trial | free`. */
  tier: 'elite' | 'pro' | 'trial' | 'free';
  /** Trial countdown — null for subscribed or free-expired wallets. */
  trial: {
    inTrial: boolean;
    daysRemaining: number;
    trialExpiresAt: number;
    dailyUsed: number;
    dailyCap: number;
  } | null;
  /** Reason when `tier === 'free'`. */
  freeReason: 'never_started' | 'trial_expired' | 'operator_killed' | null;
  /** Legacy view — kept for one release for client backward compat. */
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
}

const ELITE_DISPLAY_LIMIT = 999_999;

/**
 * Returns the current state for a wallet. Callers that haven't
 * authenticated should NOT call this — use the route-level 401 path
 * instead.
 *
 * **Side effect: auto-seeds the 7-day Pro trial on first call.**
 * `startTrialIfNew()` runs an `INSERT OR IGNORE` so the second-and-
 * onwards calls are no-ops at the DB layer — safe to invoke on every
 * /api/quota request without performance worry.
 *
 * Why seed here instead of at the SIWS verify boundary: the trial
 * state IS the entitlement state, and /api/quota is the canonical
 * read for "what tier is this wallet". Without the auto-seed, a
 * freshly-signed-in wallet sat at `tier='free', freeReason='never_started'`
 * — exhausted=true — until they made their FIRST /predict call, which
 * the composer-lock prevented because the same quota read said the
 * composer should be locked. Chicken-and-egg: the trial start was
 * gated on a path the user couldn't reach because the trial hadn't
 * started. Auto-seeding on first quota check resolves it cleanly
 * without coupling the SIWS verify route to the tier-resolver
 * lifecycle.
 */
export function readWalletQuota(wallet: string): QuotaState {
  return projectFromEffective(resolveTierWithTrialStart(wallet));
}

function projectFromEffective(effective: EffectiveTier): QuotaState {
  switch (effective.kind) {
    case 'elite':
      return {
        tier: 'elite',
        trial: null,
        freeReason: null,
        used: 0,
        limit: ELITE_DISPLAY_LIMIT,
        remaining: ELITE_DISPLAY_LIMIT,
        exhausted: false,
      };
    case 'pro':
      return {
        tier: 'pro',
        trial: null,
        freeReason: null,
        used: effective.dailyUsed,
        limit: effective.dailyCap,
        remaining: Math.max(0, effective.dailyCap - effective.dailyUsed),
        exhausted: effective.dailyUsed >= effective.dailyCap,
      };
    case 'trial':
      return {
        tier: 'trial',
        trial: {
          inTrial: true,
          daysRemaining: effective.daysRemaining,
          trialExpiresAt: effective.trialExpiresAt,
          dailyUsed: effective.dailyUsed,
          dailyCap: effective.dailyCap,
        },
        freeReason: null,
        used: effective.dailyUsed,
        limit: effective.dailyCap,
        remaining: Math.max(0, effective.dailyCap - effective.dailyUsed),
        exhausted: effective.dailyUsed >= effective.dailyCap,
      };
    case 'free':
      return {
        tier: 'free',
        trial: null,
        freeReason: effective.reason,
        used: 0,
        limit: 0,
        remaining: 0,
        exhausted: true,
      };
  }
}
