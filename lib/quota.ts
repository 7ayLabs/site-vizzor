/**
 * Free-tier quota tracking via HTTP cookie.
 *
 * The free tier (3 predictions per browser by default) is gated by a
 * single cookie `vizzor.free_used` holding an integer count. This is
 * intentionally a soft gate — opening an incognito window resets the
 * counter, and the cookie is not signed. That's acceptable: the free
 * tier is a lead magnet, not a security boundary. The on-chain $VIZZOR
 * burn (Phase 2) is the firm paywall.
 *
 * Cookie attributes:
 *   - HttpOnly      — client JS can't tamper; the dedicated /api/quota
 *                     endpoint surfaces the value to the UI.
 *   - SameSite=Lax  — sent on top-level navigations, blocked on third-
 *                     party requests.
 *   - Max-Age 30d   — long enough to feel sticky, short enough that
 *                     long-lapsed users get a courtesy reset.
 *   - Path /        — every route sees the same counter.
 */

import { cookies } from 'next/headers';
import { freePredictions } from './feature-flags';

export const QUOTA_COOKIE = 'vizzor.free_used';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
}

export async function readQuota(): Promise<QuotaState> {
  const limit = freePredictions();
  const raw = (await cookies()).get(QUOTA_COOKIE)?.value;
  const used = clampUsed(Number.parseInt(raw ?? '0', 10), limit);
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    exhausted: used >= limit,
  };
}

/**
 * Build a `Set-Cookie` value for the incremented counter. Returns just
 * the header value (not the header itself) so callers can attach it to
 * whatever Response they're returning — streaming responses need this
 * level of control.
 */
export function buildIncrementedQuotaCookie(currentUsed: number): string {
  const next = currentUsed + 1;
  const attrs = [
    `${QUOTA_COOKIE}=${next}`,
    'Path=/',
    `Max-Age=${MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  return attrs.join('; ');
}

function clampUsed(value: number, limit: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  // Don't clamp at limit — we want the cookie to be able to overshoot
  // (e.g. after a paid burn we may want to mark someone as 'gold tier'
  // separately, not here). Simply allow large integers.
  return Math.min(value, limit + 1_000_000);
}
