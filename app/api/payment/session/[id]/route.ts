/**
 * GET /api/payment/session/[id] — read a session's status.
 *
 * The checkout UI polls this every ~5s while the user is signing /
 * waiting for confirmation. Returns the session row verbatim. On the
 * first poll where `status === 'confirmed'` AND no grantCode has been
 * minted yet, this route also calls `issueGrantForSession()` so the
 * grant code is ready to surface in the next poll response.
 *
 * Polling optimization — ETag + If-None-Match. The session row is
 * mutated by the on-chain watcher; between mutations the response is
 * byte-identical across polls. We compute a deterministic ETag from
 * `(status, txSig, grantCode, expiresAt)` and short-circuit unchanged
 * responses to 304 with no body. The client polls a small header
 * round-trip until the watcher confirms, instead of repeatedly
 * shipping the full session JSON.
 *
 * Idempotent: subsequent polls just return the persisted grant code.
 */

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { getSession, issueGrantForSession } from '@/lib/payment/session';
import type { PaymentSession } from '@/lib/payment/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function computeEtag(s: PaymentSession): string {
  // Stable per-state fingerprint — same state across polls yields the
  // same ETag without serializing the whole object.
  const hash = createHash('sha256');
  hash.update(s.sessionId);
  hash.update('|');
  hash.update(s.status);
  hash.update('|');
  hash.update(s.txSig ?? '');
  hash.update('|');
  hash.update(s.grantCode ?? '');
  hash.update('|');
  hash.update(String(s.expiresAt));
  return `W/"${hash.digest('hex').slice(0, 16)}"`;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<unknown> },
) {
  const params = (await ctx.params) as { id?: string };
  const id = params?.id ?? '';

  const result = await getSession(id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason },
      { status: result.reason === 'invalid_input' ? 400 : 503 },
    );
  }

  let session = result.session;

  // First confirmed poll → mint a grant code.
  if (session.status === 'confirmed' && !session.grantCode) {
    const granted = await issueGrantForSession(session.sessionId);
    if (granted) {
      session = { ...session, grantCode: granted.code };
    }
  }

  const etag = computeEtag(session);
  const ifNoneMatch = req.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch === etag) {
    // 304 — client's cached body is still authoritative. No payload.
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': 'no-store',
      },
    });
  }

  return NextResponse.json(
    { ok: true, session },
    {
      headers: {
        'Cache-Control': 'no-store',
        ETag: etag,
      },
    },
  );
}
