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
  parseSiwsMessageString,
  resolveSiwsContext,
  siwsActionFromStatement,
  verifySiwsSignature,
  verifySiwsSignatureBytes,
  type SiwsAction,
} from '@/lib/payment/siws';
import { insertAuthSession } from '@/lib/payment/db';
import { enforceRateLimit } from '@/lib/payment/rate-limit';
import { checkOrigin } from '@/lib/payment/origin-check';
import { authCookieName, hashAuthToken } from '@/lib/payment/auth-session';

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
  // Base64-encoded bytes the wallet returned from Wallet Standard
  // `signIn`. When present, this is the authoritative payload to
  // verify — the wallet is allowed to prefix/modify the canonical
  // message before signing, so server-side reconstruction wouldn't
  // match. Optional: legacy `signMessage` clients omit it.
  signedMessage?: unknown;
}

export async function POST(req: Request) {
  const origin = checkOrigin(req);
  if (!origin.ok) {
    return NextResponse.json({ ok: false, reason: origin.reason }, { status: 403 });
  }
  const limited = enforceRateLimit(req, 'auth.siws.verify');
  if (limited) return limited;

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

  // ── Branch on signature source ──────────────────────────────────
  //
  // Path A: Wallet Standard `signIn` returned the exact bytes it
  // signed. The wallet is allowed to prefix or otherwise modify the
  // canonical SIWS message before signing (spec: "The wallet may
  // prefix or otherwise modify the message before signing it."), so
  // we MUST verify against those bytes and extract the
  // security-relevant fields by parsing them — not by rebuilding the
  // canonical form. This is the path that resolves the Phantom
  // "Unexpected error" failures: previously the server-rebuilt
  // message never byte-matched what Phantom internally signed.
  //
  // Path B: Legacy `signMessage` clients sent the canonical message
  // unchanged. We reconstruct from request context + body timestamps
  // and verify, same as before.
  const signedMessageB64 =
    typeof body.signedMessage === 'string' ? body.signedMessage : null;

  if (signedMessageB64) {
    let signedBytes: Uint8Array;
    try {
      signedBytes = Uint8Array.from(Buffer.from(signedMessageB64, 'base64'));
    } catch {
      return NextResponse.json(
        { ok: false, reason: 'invalid_signed_message' },
        { status: 400 },
      );
    }
    if (signedBytes.length === 0) {
      return NextResponse.json(
        { ok: false, reason: 'invalid_signed_message' },
        { status: 400 },
      );
    }
    if (!verifySiwsSignatureBytes(signedBytes, signature, wallet)) {
      return NextResponse.json(
        { ok: false, reason: 'signature_invalid' },
        { status: 401 },
      );
    }
    // Parse the bytes the wallet actually signed. Every assertion
    // below is a security check: the signature alone proves nothing
    // unless we know *what* it endorses.
    const parsed = parseSiwsMessageString(
      new TextDecoder().decode(signedBytes),
    );
    if (!parsed) {
      return NextResponse.json(
        { ok: false, reason: 'malformed_signed_message' },
        { status: 400 },
      );
    }
    if (parsed.nonce !== nonce) {
      return NextResponse.json(
        { ok: false, reason: 'nonce_mismatch' },
        { status: 400 },
      );
    }
    if (parsed.address !== wallet) {
      return NextResponse.json(
        { ok: false, reason: 'wallet_mismatch' },
        { status: 400 },
      );
    }
    const parsedAction = siwsActionFromStatement(parsed.statement);
    if (parsedAction !== ROUTE_ACTION) {
      return NextResponse.json(
        { ok: false, reason: 'action_statement_mismatch' },
        { status: 400 },
      );
    }
    // Expiration: enforce if the wallet kept the field, otherwise
    // fall back to the nonce-TTL sanity check below.
    if (parsed.expirationTime) {
      const exp = Date.parse(parsed.expirationTime);
      if (!Number.isNaN(exp) && Date.now() > exp) {
        return NextResponse.json(
          { ok: false, reason: 'nonce_expired' },
          { status: 400 },
        );
      }
    }
    if (parsed.issuedAt) {
      const iat = Date.parse(parsed.issuedAt);
      if (
        !Number.isNaN(iat) &&
        Date.now() - iat > NONCE_TTL_MS + 30_000
      ) {
        return NextResponse.json(
          { ok: false, reason: 'nonce_expired' },
          { status: 400 },
        );
      }
    }
  } else {
    // Legacy signMessage path — server reconstructs canonical message
    // and verifies. Kept so wallets without Wallet Standard signIn
    // (older builds, deeplink callbacks) still authenticate.
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
    const siwsCtx = resolveSiwsContext(req);
    const message = buildSiwsMessage({
      wallet,
      nonce,
      action: ROUTE_ACTION,
      issuedAt,
      expiresAt,
      domain: siwsCtx.domain,
      uri: siwsCtx.uri,
      chainId: siwsCtx.chainId,
    });
    if (!verifySiwsSignature(message, signature, wallet)) {
      return NextResponse.json(
        { ok: false, reason: 'signature_invalid' },
        { status: 401 },
      );
    }
  }

  // Mint the auth session. The raw token is what the browser receives
  // in the HttpOnly cookie; the DB stores SHA-256(rawToken) so a DB
  // leak doesn't yield a usable credential. See auth-session.ts.
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
  // `Secure` is added in production so cookies are never carried over
  // plaintext HTTP (RFC §4.10 / B6). Staging without TLS keeps the
  // pre-patch behavior.
  const isProd = process.env.NODE_ENV === 'production';
  const secure = isProd ? '; Secure' : '';
  // SameSite=Strict in production to block cross-site CSRF on the auth
  // cookie; Lax in dev so localhost reloads from a tooling tab still
  // present the session. The `__Host-` prefix in prod requires Secure +
  // Path=/ + no Domain — all three are satisfied below.
  const sameSite = isProd ? 'Strict' : 'Lax';
  const cookieName = authCookieName();
  // Delete the nonce cookie so it can't be replayed.
  headers.append(
    'Set-Cookie',
    `vizzor.siws.nonce=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Strict${secure}`,
  );
  // Set the auth-session cookie under the env-appropriate name.
  headers.append(
    'Set-Cookie',
    `${cookieName}=${token}; Path=/; Max-Age=${Math.floor(AUTH_TTL_MS / 1000)}; HttpOnly; SameSite=${sameSite}${secure}`,
  );

  return new NextResponse(
    JSON.stringify({ ok: true, wallet, expiresAt: authExpiresAt }),
    { status: 200, headers },
  );
}
