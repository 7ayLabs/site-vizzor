/**
 * GET /api/auth/session — current auth state for the browser.
 *
 * Returns the wallet address (if signed in) and any active
 * subscription on that wallet. Used by /predict and /pay to display
 * "signed in as 4Az…7Pq · Elite Lifetime active" badges and to gate
 * features behind a sub.
 *
 * DELETE /api/auth/session — sign out.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  AUTH_COOKIE,
  AUTH_COOKIE_HOST,
  getActiveSession,
  getSubscriptionForActiveSession,
  hashAuthToken,
} from '@/lib/payment/auth-session';
import { deleteAuthSession } from '@/lib/payment/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const sess = await getActiveSession();
  if (!sess) {
    return NextResponse.json(
      { ok: true, signedIn: false },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const sub = await getSubscriptionForActiveSession();
  return NextResponse.json(
    {
      ok: true,
      signedIn: true,
      wallet: sess.wallet,
      expiresAt: sess.expiresAt,
      subscription: sub
        ? {
            tier: sub.tier,
            cadence: sub.cadence,
            expiresAt: sub.expires_at,
            isLifetime: sub.expires_at === null,
          }
        : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function DELETE() {
  const jar = await cookies();
  // Try both cookie names (prod uses __Host-vizzor.auth, dev uses
  // vizzor.auth; old prod browsers may still have the legacy name
  // during a deploy-window rotation).
  const raw = jar.get(AUTH_COOKIE_HOST)?.value ?? jar.get(AUTH_COOKIE)?.value;
  // Hash before the DB lookup so it matches the stored hex digest.
  if (raw) deleteAuthSession(hashAuthToken(raw));

  const isProd = process.env.NODE_ENV === 'production';
  const secure = isProd ? '; Secure' : '';
  const sameSite = isProd ? 'Strict' : 'Lax';

  const headers = new Headers({ 'Cache-Control': 'no-store' });
  // Clear BOTH possible cookie names so a user who signed in pre-rotation
  // is fully signed out regardless of which one their browser still holds.
  headers.append(
    'Set-Cookie',
    `${AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=${sameSite}${secure}`,
  );
  headers.append(
    'Set-Cookie',
    `${AUTH_COOKIE_HOST}=; Path=/; Max-Age=0; HttpOnly; SameSite=${sameSite}${secure}`,
  );
  return new NextResponse(JSON.stringify({ ok: true }), {
    status: 200,
    headers,
  });
}
