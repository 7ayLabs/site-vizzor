/**
 * GET /api/payment/session/[id] — read a session's status.
 *
 * The checkout UI polls this every ~3s while the user is signing /
 * waiting for confirmation. Returns the engine's session record
 * verbatim. On the first poll where `status === 'confirmed'` AND no
 * grantCode has been minted yet, this route also calls
 * `POST /v1/grants` server-to-server so the grant code is ready to
 * surface in the next poll response.
 *
 * Idempotent: subsequent polls just return the persisted grant code.
 */

import { NextResponse } from 'next/server';
import { getSession, issueGrantForSession } from '@/lib/payment/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _req: Request,
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

  // First confirmed poll → mint a grant code via the engine.
  if (session.status === 'confirmed' && !session.grantCode) {
    const granted = await issueGrantForSession(session.sessionId);
    if (granted) {
      session = { ...session, grantCode: granted.code };
    }
  }

  return NextResponse.json(
    { ok: true, session },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
