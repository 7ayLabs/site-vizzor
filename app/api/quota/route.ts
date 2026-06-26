/**
 * GET /api/quota — current plan + trial state for the active wallet.
 *
 * v0.3.2: the response moved from count-based (used/limit/remaining)
 * to trial-aware. New clients read `tier` + `trial`; legacy fields
 * (`used`, `limit`, `remaining`, `exhausted`) are preserved for one
 * release so older bundles loaded from disk cache don't crash.
 *
 * Three shapes:
 *   1. No SIWS session    → `{ connected: false, tier: 'free', ... }`
 *   2. Authenticated      → `{ connected: true, tier, trial, subscription }`
 *   3. Subscribed         → as above with `subscription` populated and
 *                             `subscribed: true`.
 */

import { NextResponse } from 'next/server';
import { readWalletQuota, type QuotaState } from '@/lib/quota';
import {
  getActiveSession,
  getSubscriptionForActiveSession,
} from '@/lib/payment/auth-session';
import { trialDailyCap } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      {
        connected: false,
        tier: 'free' as const,
        trial: null,
        freeReason: 'never_started' as const,
        subscribed: false,
        subscription: null,
        // legacy mirror
        used: 0,
        limit: trialDailyCap(),
        remaining: trialDailyCap(),
        exhausted: false,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const quota: QuotaState = readWalletQuota(session.wallet);
  const sub = await getSubscriptionForActiveSession();
  const subscribed = !!sub;

  return NextResponse.json(
    {
      connected: true,
      tier: quota.tier,
      trial: quota.trial,
      freeReason: quota.freeReason,
      subscribed,
      subscription: sub
        ? {
            tier: sub.tier,
            cadence: sub.cadence,
            expiresAt: sub.expires_at,
            // v0.4 — pre-scheduled plan transition (cancel /
            // downgrade-to-pro) the user requested from /account.
            // Null when no schedule is set. Consumers use this to
            // surface "plan continues until {date}, then drops to
            // {target}" without changing the underlying lifecycle.
            scheduledAction: sub.scheduled_action ?? null,
          }
        : null,
      // legacy mirror — drop in v0.3.3
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining,
      exhausted: quota.exhausted,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
