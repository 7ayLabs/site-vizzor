/**
 * GET /api/quota — current free-tier state for the active browser.
 *
 * Returns `{ used, limit, remaining, exhausted, subscribed, subscription }`
 * so the chat sidebar can render the right state (free / paywall /
 * subscribed) without also reading the HttpOnly quota cookie directly.
 */

import { NextResponse } from 'next/server';
import { readQuota } from '@/lib/quota';
import { getSubscriptionForActiveSession } from '@/lib/payment/auth-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const quota = await readQuota();
  const sub = await getSubscriptionForActiveSession();
  const subscribed = !!sub;
  return NextResponse.json(
    {
      ...quota,
      // When the visitor is signed in with a wallet that has an
      // active subscription, the free-tier quota becomes irrelevant:
      // /api/predict bypasses the gate for subscribed wallets.
      subscribed,
      subscription: sub
        ? {
            tier: sub.tier,
            cadence: sub.cadence,
            expiresAt: sub.expires_at,
          }
        : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
