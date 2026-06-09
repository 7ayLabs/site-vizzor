/**
 * POST /api/quota/reset — dev-only quota reset for the active wallet.
 *
 * v0.3.0: with the counter moved into SQLite (wallet_free_usage), this
 * endpoint now deletes the wallet's row. Anonymous callers return 401;
 * production callers return 404 unless `ALLOW_QUOTA_RESET=true`.
 *
 * Defense layers:
 *
 *   1. The endpoint returns 404 in production unless explicitly enabled
 *      (`ALLOW_QUOTA_RESET=true`). The override exists for support cases.
 *   2. Callers must hold a valid SIWS session — the wallet to reset is
 *      derived from the cookie, never accepted as a body parameter.
 *   3. The matching UI affordance is gated on
 *      `process.env.NODE_ENV !== 'production'` and dead-code-eliminated
 *      from the production bundle.
 */

import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import { getDb } from '@/lib/payment/db';
import { freePredictions } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function resetAllowed(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.ALLOW_QUOTA_RESET === 'true';
}

export async function POST() {
  if (!resetAllowed()) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { error: 'wallet_required' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  getDb()
    .prepare(`DELETE FROM wallet_free_usage WHERE wallet_address = ?`)
    .run(session.wallet);

  const limit = freePredictions();
  return NextResponse.json(
    { used: 0, limit, remaining: limit, exhausted: false },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
