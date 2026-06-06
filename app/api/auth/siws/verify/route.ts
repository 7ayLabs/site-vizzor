/**
 * POST /api/auth/siws/verify — verify a SIWS signature and mint an
 * auth session.
 *
 * Body: { wallet, signature, action?, issuedAt, expiresAt }
 *
 * The server reads the nonce cookie (issued by /nonce), recomputes
 * the canonical SIWS message with `action: 'login'`, and verifies the
 * signature with ed25519. The cookie's embedded action MUST match the
 * body's action AND equal the route's expected action (`login`),
 * preventing cross-route replay (RFC §5.2). On success, deletes the
 * nonce, mints a 24h auth-session token, persists it in
 * `auth_sessions`, and returns it as an HttpOnly cookie.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  AUTH_TTL_MS,
  NONCE_TTL_MS,
  buildSiwsMessage,
  generateAuthToken,
  isValidSolanaAddress,
  parseSiwsAction,
  verifySiwsSignature,
  type SiwsAction,
} from '@/lib/payment/siws';
import { insertAuthSession } from '@/lib/payment/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ROUTE_ACTION: SiwsAction = 'login';

interface Body {
  wallet?: unknown;
  signature?: unknown;
  action?: unknown;
  // The message the wallet actually signed; we recompute server-side
  // for safety but accept the client copy too for cross-check.
  issuedAt?: unknown;
  expiresAt?: unknown;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_body' }, { status: 400 });
  }
  const wallet = String(body.wallet ?? '');
  const signature = String(body.signature ?? '');
  if (!isValidSolanaAddress(wallet) || signature.length === 0) {
    return NextResponse.json({ ok: false, reason: 'invalid_input' }, { status: 400 });
  }

  const jar = await cookies();
  const nonceCookie = jar.get('vizzor.siws.nonce')?.value;
  if (!nonceCookie) {
    return NextResponse.json(
      { ok: false, reason: 'nonce_missing' },
      { status: 400 },
    );
  }
  // Cookie shape: `<nonce>.<wallet>.<action>`. Pre-patch cookies have
  // only two segments; we treat that as `action: 'login'` for the
  // brief deploy-window overlap and reject everything else.
  const segments = nonceCookie.split('.');
  const [nonce, boundWallet, boundActionRaw] = segments;
  if (!nonce || boundWallet !== wallet) {
    return NextResponse.json(
      { ok: false, reason: 'nonce_mismatch' },
      { status: 400 },
    );
  }
  const cookieAction: SiwsAction =
    parseSiwsAction(boundActionRaw) ?? 'login';
  // Body action defaults to the route's action for back-compat with
  // clients that have not been updated yet. The cookie⇄body match
  // below is the real defense.
  const bodyAction: SiwsAction =
    parseSiwsAction(body.action) ?? ROUTE_ACTION;
  if (cookieAction !== bodyAction || cookieAction !== ROUTE_ACTION) {
    return NextResponse.json(
      { ok: false, reason: 'action_mismatch' },
      { status: 400 },
    );
  }

  // Recompute the message — must match exactly what the wallet signed.
  // The /nonce endpoint computed `issuedAt = now` and `expiresAt =
  // now + NONCE_TTL_MS`. We allow the client to echo back its copy
  // of those timestamps for byte-exact reconstruction.
  let issuedAt: Date;
  let expiresAt: Date;
  try {
    issuedAt = new Date(String(body.issuedAt ?? ''));
    expiresAt = new Date(String(body.expiresAt ?? ''));
    if (
      Number.isNaN(issuedAt.getTime()) ||
      Number.isNaN(expiresAt.getTime())
    ) {
      throw new Error('bad-date');
    }
    // Sanity-check the issuedAt is within the nonce TTL window.
    if (Date.now() - issuedAt.getTime() > NONCE_TTL_MS + 30_000) {
      return NextResponse.json(
        { ok: false, reason: 'nonce_expired' },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_timestamps' },
      { status: 400 },
    );
  }

  const message = buildSiwsMessage({
    wallet,
    nonce,
    action: ROUTE_ACTION,
    issuedAt,
    expiresAt,
  });

  if (!verifySiwsSignature(message, signature, wallet)) {
    return NextResponse.json(
      { ok: false, reason: 'signature_invalid' },
      { status: 401 },
    );
  }

  // Mint the auth session.
  const token = generateAuthToken();
  const authExpiresAt = Date.now() + AUTH_TTL_MS;
  insertAuthSession({
    token,
    wallet_address: wallet,
    expires_at: authExpiresAt,
  });

  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  });
  // `Secure` is added in production so cookies are never carried over
  // plaintext HTTP (RFC §4.10 / B6). Staging without TLS keeps the
  // pre-patch behavior.
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  // Delete the nonce cookie so it can't be replayed.
  headers.append(
    'Set-Cookie',
    `vizzor.siws.nonce=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Strict${secure}`,
  );
  // Set the auth-session cookie.
  headers.append(
    'Set-Cookie',
    `vizzor.auth=${token}; Path=/; Max-Age=${Math.floor(AUTH_TTL_MS / 1000)}; HttpOnly; SameSite=Lax${secure}`,
  );

  return new NextResponse(
    JSON.stringify({ ok: true, wallet, expiresAt: authExpiresAt }),
    { status: 200, headers },
  );
}
