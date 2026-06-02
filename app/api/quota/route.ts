/**
 * GET /api/quota — current free-tier state for the active browser.
 *
 * Returns `{ used, limit, remaining, exhausted, isLive }` so the chat
 * sidebar can render the right state (free / paywall / wallet) without
 * also reading the HttpOnly quota cookie directly.
 *
 * `isLive` echoes the `NEXT_PUBLIC_TOKEN_LIVE` flag so the sidebar
 * knows whether to surface "connect wallet" or "launching soon".
 */

import { NextResponse } from 'next/server';
import { readQuota } from '@/lib/quota';
import { isTokenLive } from '@/lib/feature-flags';
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
      isLive: isTokenLive(),
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
