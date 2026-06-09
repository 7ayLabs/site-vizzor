/**
 * Free-tier quota tracking, wallet-bound (v0.3.0).
 *
 * The free tier (default 7 predictions per SIWS-bound wallet) is gated
 * by a DB counter keyed on the wallet address. This is a hard gate:
 * unlike the legacy cookie approach, clearing storage / using incognito
 * cannot reset the counter. The wallet must complete SIWS for the
 * counter to be readable at all.
 *
 * Subscriptions still bypass entirely — the counter is only consulted
 * on the free path.
 */

import {
  getWalletFreeUsage,
  incrementWalletFreeUsage,
} from './payment/db';
import { freePredictions } from './feature-flags';

export interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
}

/**
 * Returns the current free-tier state for a specific wallet. Callers
 * that haven't authenticated should NOT call this — use the route-level
 * 401 path instead.
 */
export function readWalletQuota(wallet: string): QuotaState {
  const limit = freePredictions();
  const used = getWalletFreeUsage(wallet);
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    exhausted: used >= limit,
  };
}

/** Atomically increments a wallet's counter and returns the new state. */
export function incrementWalletQuota(wallet: string): QuotaState {
  const limit = freePredictions();
  const used = incrementWalletFreeUsage(wallet);
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    exhausted: used >= limit,
  };
}
