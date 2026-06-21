/**
 * POST /api/auth/siws/nonce — issue a SIWS nonce + canonical message.
 *
 * Body: { wallet: string, action?: 'login' | 'link' }
 * Returns: { nonce, message, issuedAt, expiresAt, action }
 *
 * The nonce is also stored in a short-lived HttpOnly cookie so the
 * /verify endpoint can confirm replay-safety (single nonce per
 * verify; rotates on each /nonce call). The cookie stores wallet AND
 * action so the verify route can assert both bindings (RFC §5.2).
 *
 * `action` defaults to `login` when missing for backward compatibility
 * during the deploy window; new clients SHOULD send it explicitly.
 */

import { NextResponse } from 'next/server';
import {
  NONCE_TTL_MS,
  buildSiwsMessage,
  generateNonce,
  isValidSolanaAddress,
  parseSiwsAction,
  resolveSiwsContext,
  type SiwsAction,
} from '@/lib/payment/siws';
import { enforceRateLimit } from '@/lib/payment/rate-limit';
import { checkOrigin } from '@/lib/payment/origin-check';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  wallet?: unknown;
  action?: unknown;
}

export async function POST(req: Request) {
  // Origin defense-in-depth: reject cross-origin POSTs before parsing.
  const origin = checkOrigin(req);
  if (!origin.ok) {
    return NextResponse.json({ ok: false, reason: origin.reason }, { status: 403 });
  }
  const limited = enforceRateLimit(req, 'auth.siws.nonce');
  if (limited) return limited;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_body' }, { status: 400 });
  }
  const wallet = String(body.wallet ?? '');
  if (!isValidSolanaAddress(wallet)) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_wallet' },
      { status: 400 },
    );
  }

  // Backwards compatible default. Verify routes still assert the action
  // matches the route they live on, so a missing-action client signing
  // an unintended message cannot escalate scope.
  const action: SiwsAction = parseSiwsAction(body.action) ?? 'login';

  const nonce = generateNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
  // SIWS context resolution: domain, URI and chain ID must match the
  // origin the user loaded the dapp from AND the active payment
  // network. Phantom (and the SIWS standard) reject signatures where
  // these don't match. The /verify endpoint runs the SAME resolution
  // against its incoming request — both sides arrive at byte-identical
  // message strings, so the ed25519 signature verifies.
  const siwsCtx = resolveSiwsContext(req);
  const message = buildSiwsMessage({
    wallet,
    nonce,
    action,
    issuedAt,
    expiresAt,
    domain: siwsCtx.domain,
    uri: siwsCtx.uri,
    chainId: siwsCtx.chainId,
  });

  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  });
  // HttpOnly so client JS can't read it; bound to /api/auth so the
  // /verify endpoint sees it on the follow-up request. `Secure` is
  // added in production so the cookie is never sent over plaintext
  // HTTP (RFC §4.10 / B6).
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  headers.append(
    'Set-Cookie',
    `vizzor.siws.nonce=${nonce}.${wallet}.${action}; Path=/api/auth; Max-Age=${Math.floor(NONCE_TTL_MS / 1000)}; HttpOnly; SameSite=Strict${secure}`,
  );

  return new NextResponse(
    JSON.stringify({
      ok: true,
      nonce,
      message,
      action,
      // chainId is echoed back so the client can pass it as `chainId`
      // in the Wallet Standard `signIn` input. Phantom (especially in
      // Testnet Mode) refuses to sign when its current chain isn't
      // explicitly declared by the dapp — the prompt renders but the
      // user's Confirm click resolves to "Unexpected error". Echoing
      // the resolved value keeps client + server byte-aligned and
      // lets Phantom's chain enforcement pass.
      chainId: siwsCtx.chainId,
      domain: siwsCtx.domain,
      uri: siwsCtx.uri,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }),
    { status: 200, headers },
  );
}
