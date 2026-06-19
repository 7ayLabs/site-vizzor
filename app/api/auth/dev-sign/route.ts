/**
 * POST /api/auth/dev-sign — developer-only auth bypass.
 *
 * Mints an `auth_sessions` row + sets the auth-session cookie WITHOUT
 * requiring a Phantom signature. Exists because Phantom on localhost
 * + multi-chain Testnet Mode (Solana Devnet + Ethereum Sepolia) can
 * reject SIWS sign requests with the generic `"Unexpected error"` —
 * this gives developers a way around the wallet entirely while still
 * exercising the rest of the auth-gated UI (`/predict`, `/account`,
 * quota, conversations).
 *
 * Triple-gated. The endpoint returns 404 unless ALL of these hold:
 *   1. `process.env.NODE_ENV === 'development'`
 *   2. `process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH === 'true'`
 *   3. `checkOrigin(req)` resolves to a `localhost`-class origin
 *
 * The 404 is intentional: any non-dev caller sees the same response
 * whether the route doesn't exist or the env vars aren't set, so the
 * mere presence of the route doesn't leak the bypass capability.
 *
 * Body shape:  { wallet: string }   (a valid base58 Solana address)
 * Success:     200 { ok: true, wallet, expiresAt } + auth cookie
 * Anything else: 404
 */

import { NextResponse } from 'next/server';
import {
  AUTH_TTL_MS,
  generateAuthToken,
  isValidSolanaAddress,
} from '@/lib/payment/siws';
import { insertAuthSession } from '@/lib/payment/db';
import { authCookieName, hashAuthToken } from '@/lib/payment/auth-session';
import { checkOrigin } from '@/lib/payment/origin-check';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isLocalhostOrigin(req: Request): boolean {
  const raw =
    req.headers.get('origin') ?? req.headers.get('referer') ?? '';
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return (
      u.hostname === 'localhost' ||
      u.hostname === '127.0.0.1' ||
      u.hostname === '::1'
    );
  } catch {
    return false;
  }
}

function devAuthAllowed(req: Request): boolean {
  if (process.env.NODE_ENV !== 'development') return false;
  if (process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH !== 'true') return false;
  if (!isLocalhostOrigin(req)) return false;
  return true;
}

export async function POST(req: Request) {
  if (!devAuthAllowed(req)) {
    return new NextResponse('Not Found', { status: 404 });
  }
  // Still enforce the standard origin allow-list so a misconfigured
  // dev box doesn't accept arbitrary cross-origin POSTs.
  const origin = checkOrigin(req);
  if (!origin.ok) {
    return NextResponse.json(
      { ok: false, reason: origin.reason },
      { status: 403 },
    );
  }

  let body: { wallet?: unknown };
  try {
    body = (await req.json()) as { wallet?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body' },
      { status: 400 },
    );
  }
  const wallet = String(body.wallet ?? '');
  if (!isValidSolanaAddress(wallet)) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_wallet' },
      { status: 400 },
    );
  }

  const token = generateAuthToken();
  const authExpiresAt = Date.now() + AUTH_TTL_MS;
  insertAuthSession({
    token: hashAuthToken(token),
    wallet_address: wallet,
    expires_at: authExpiresAt,
  });

  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  });
  // Localhost-only: no `Secure`, `SameSite=Lax` so tooling tabs can
  // present the cookie back on the follow-up `/predict` navigation.
  const cookieName = authCookieName();
  headers.append(
    'Set-Cookie',
    `${cookieName}=${token}; Path=/; Max-Age=${Math.floor(AUTH_TTL_MS / 1000)}; HttpOnly; SameSite=Lax`,
  );

  return new NextResponse(
    JSON.stringify({ ok: true, wallet, expiresAt: authExpiresAt }),
    { status: 200, headers },
  );
}
