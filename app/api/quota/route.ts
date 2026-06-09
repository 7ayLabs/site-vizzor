/**
 * GET /api/quota — current free-tier state for the active wallet.
 *
 * v0.3.0: the gate moved from a browser cookie to a wallet-bound DB
 * counter. The client now gets one of three shapes back:
 *
 *   1. No SIWS session    → { connected: false, limit, used: 0 }
 *   2. Authenticated free → { connected: true, used, limit, remaining,
 *                             exhausted, subscribed: false, ... }
 *   3. Authenticated sub  → as above plus subscribed: true and the
 *                             subscription block. Counter is informational
 *                             only; subscribers bypass the gate.
 */

import { NextResponse } from 'next/server';
import { readWalletQuota } from '@/lib/quota';
import {
  getActiveSession,
  getSubscriptionForActiveSession,
} from '@/lib/payment/auth-session';
import { freePredictions } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      {
        connected: false,
        used: 0,
        limit: freePredictions(),
        remaining: freePredictions(),
        exhausted: false,
        subscribed: false,
        subscription: null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const quota = readWalletQuota(session.wallet);
  const sub = await getSubscriptionForActiveSession();
  const subscribed = !!sub;

  return NextResponse.json(
    {
      connected: true,
      ...quota,
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
