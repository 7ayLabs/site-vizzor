/**
 * POST /api/quota/reset — dev-only quota reset.
 *
 * Two layers of defense ensure this is unusable by anonymous users on
 * production:
 *
 *   1. The endpoint itself returns 404 when `NODE_ENV === 'production'`
 *      AND `ALLOW_QUOTA_RESET !== 'true'`. The override exists so the
 *      operator can re-enable it temporarily (e.g. during a support
 *      incident) without redeploying.
 *
 *   2. The matching UI affordance in <QuotaSidebar> is gated on
 *      `process.env.NODE_ENV !== 'production'`, which Next.js inlines
 *      at build time — the button is dead-code-eliminated from the
 *      production bundle entirely.
 *
 * Even with both gates open the cookie is HttpOnly + SameSite=Lax, so
 * third-party scripts can't trigger this on the user's behalf.
 */

import { NextResponse } from 'next/server';
import { QUOTA_COOKIE } from '@/lib/quota';
import { freePredictions, isTokenLive } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function resetAllowed(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.ALLOW_QUOTA_RESET === 'true';
}

export async function POST() {
  if (!resetAllowed()) {
    // Match the body shape of an unmatched Next.js route to avoid
    // confirming the endpoint exists. Don't leak that the gate fired.
    return new NextResponse('Not Found', { status: 404 });
  }

  // Write the cookie VALUE to "0" with a normal Max-Age rather than
  // attempting expiry via Max-Age=0. Two reasons:
  //   1. Cookie deletion requires every attribute on the deleting
  //      cookie to match the original (Path, Domain, SameSite). Any
  //      mismatch and the browser keeps the old cookie. Setting a new
  //      value sidesteps the matching dance — name + path + domain are
  //      enough for the new cookie to replace the old.
  //   2. readQuota() treats "0" and "absent" identically (clamps to
  //      0 either way), so a value-of-0 cookie is functionally a reset.
  const limit = freePredictions();
  const fresh = {
    used: 0,
    limit,
    remaining: limit,
    exhausted: false,
    isLive: isTokenLive(),
  };

  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  });
  headers.append(
    'Set-Cookie',
    `${QUOTA_COOKIE}=0; Path=/; Max-Age=${60 * 60 * 24 * 30}; HttpOnly; SameSite=Lax`,
  );

  return new NextResponse(JSON.stringify(fresh), { status: 200, headers });
}
