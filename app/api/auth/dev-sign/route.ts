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
 * Double-gated. The endpoint returns 404 unless ALL of these hold:
 *   1. `process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH === 'true'`
 *   2. The request origin is either a `localhost`-class origin, a
 *      built-in staging host (e.g. `test.vizzor.ai`), or in the
 *      explicit `DEV_AUTH_ALLOWED_ORIGINS` allow-list (commas).
 *
 * The flag defaults to closed: the deploy workflow bakes
 * `NEXT_PUBLIC_ALLOW_DEV_AUTH=true` only for the `testing` branch via
 * the resolve job → build-args path. Production ships the env var
 * unset → endpoint 404s every call. The built-in staging origin
 * mirrors the same resolve mapping, so `test.vizzor.ai` gets the
 * silent dev-sign recovery automatically — no VPS template edit.
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

function originHeader(req: Request): string {
  return req.headers.get('origin') ?? req.headers.get('referer') ?? '';
}

function isLocalhostOrigin(req: Request): boolean {
  const raw = originHeader(req);
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

/**
 * Built-in staging hosts the dev-sign route always recognises when the
 * `NEXT_PUBLIC_ALLOW_DEV_AUTH=true` build-arg is in effect. Mirrors
 * the deploy workflow's per-branch resolve job, so `test.vizzor.ai`
 * gets the silent dev-sign recovery automatically — no VPS template
 * edit needed. Production builds ship the build-arg unset, so this
 * list is unreachable there: the outer flag gate refuses before this
 * function is ever called.
 */
const BUILTIN_STAGING_ORIGINS: readonly string[] = [
  'https://test.vizzor.ai',
  // Staging twin of app.vizzor.ai — same dev-sign recovery treatment
  // as the marketing staging so QA can hit the wallet-auth silent
  // path from either surface. Mirrors DEFAULT_APP_HOSTS in
  // middleware.ts.
  'https://testapp.vizzor.ai',
];

/**
 * Parse the explicit allow-list of dev-auth origins out of
 * `DEV_AUTH_ALLOWED_ORIGINS` (comma-separated). The match is a
 * `startsWith()` against the request's Origin/Referer so we accept the
 * configured origin regardless of trailing path. Empty values are
 * filtered. Returns an empty array if the env var isn't set — caller
 * treats that as "no extra origins allowed beyond localhost / the
 * built-in staging hosts".
 */
function allowedExtraOrigins(): string[] {
  return (process.env.DEV_AUTH_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isAllowListedOrigin(req: Request): boolean {
  const origin = originHeader(req);
  if (!origin) return false;
  if (BUILTIN_STAGING_ORIGINS.some((allowed) => origin.startsWith(allowed))) {
    return true;
  }
  const list = allowedExtraOrigins();
  if (list.length === 0) return false;
  return list.some((allowed) => origin.startsWith(allowed));
}

function devAuthAllowed(req: Request): boolean {
  if (process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH !== 'true') return false;
  return isLocalhostOrigin(req) || isAllowListedOrigin(req);
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
  // Adapt cookie attributes to the caller's origin: localhost gets a
  // permissive Lax cookie (no Secure on http://localhost); the staging
  // allow-list path lands over HTTPS so we add `Secure` so the cookie
  // is honored by browsers. SameSite stays Lax in both cases so the
  // cookie travels on the post-mint navigation back to the host page.
  const cookieName = authCookieName();
  const secureFlag = isLocalhostOrigin(req) ? '' : '; Secure';
  headers.append(
    'Set-Cookie',
    `${cookieName}=${token}; Path=/; Max-Age=${Math.floor(AUTH_TTL_MS / 1000)}; HttpOnly; SameSite=Lax${secureFlag}`,
  );

  return new NextResponse(
    JSON.stringify({ ok: true, wallet, expiresAt: authExpiresAt }),
    { status: 200, headers },
  );
}
