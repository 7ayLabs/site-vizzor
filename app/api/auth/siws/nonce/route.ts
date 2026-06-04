/**
 * POST /api/auth/siws/nonce — issue a SIWS nonce + canonical message.
 *
 * Body: { wallet: string }
 * Returns: { nonce, message, issuedAt, expiresAt }
 *
 * The nonce is also stored in a short-lived HttpOnly cookie so the
 * /verify endpoint can confirm replay-safety (single nonce per
 * verify; rotates on each /nonce call).
 */

import { NextResponse } from 'next/server';
import {
  NONCE_TTL_MS,
  buildSiwsMessage,
  generateNonce,
  isValidSolanaAddress,
} from '@/lib/payment/siws';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  wallet?: unknown;
}

export async function POST(req: Request) {
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

  const nonce = generateNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
  const message = buildSiwsMessage({
    wallet,
    nonce,
    issuedAt,
    expiresAt,
  });

  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  });
  // HttpOnly so client JS can't read it; bound to /api/auth so the
  // /verify endpoint sees it on the follow-up request.
  headers.append(
    'Set-Cookie',
    `vizzor.siws.nonce=${nonce}.${wallet}; Path=/api/auth; Max-Age=${Math.floor(NONCE_TTL_MS / 1000)}; HttpOnly; SameSite=Strict`,
  );

  return new NextResponse(
    JSON.stringify({
      ok: true,
      nonce,
      message,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }),
    { status: 200, headers },
  );
}
