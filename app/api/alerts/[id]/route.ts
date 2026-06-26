/**
 * DELETE /api/alerts/[id] — cancel an armed alert.
 *
 * SIWS-gated and rate-limited under `alerts.write`. Wallet derived
 * from the session — the engine then double-checks ownership before
 * deleting (defense-in-depth: the engine never trusts the caller).
 *
 * Status mapping:
 *   - 200 { ok: true }                             on success
 *   - 401 { ok: false, reason: 'unauthenticated' } no session
 *   - 404 { ok: false, reason: 'not_found' }       engine says no
 *   - 403 { ok: false, reason: 'forbidden' }       wallet doesn't own
 *   - 503 { ok: false, reason: 'engine_unavailable' } upstream down
 */

import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import { cancelAlertForWallet } from '@/lib/alerts';
import { enforceRateLimit } from '@/lib/payment/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const limited = enforceRateLimit(req, 'alerts.write');
  if (limited) return limited as unknown as NextResponse;

  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { id } = await ctx.params;
  if (!id || typeof id !== 'string') {
    return NextResponse.json(
      { ok: false, reason: 'invalid' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const result = await cancelAlertForWallet(session.wallet, id);
  if (!result.ok) {
    const status =
      result.reason === 'not_found'
        ? 404
        : result.reason === 'forbidden'
          ? 403
          : result.reason === 'engine_unavailable'
            ? 503
            : (result.status ?? 502);
    return NextResponse.json(
      { ok: false, reason: result.reason },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
