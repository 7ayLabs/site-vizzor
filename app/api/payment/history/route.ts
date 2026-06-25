/**
 * GET /api/payment/history — wallet-scoped confirmed payment sessions.
 *
 * Backs the /app/billing surface. SIWS-gated and rate-limited
 * (`payment.history`); returns only the requester's own confirmed
 * sessions, never another wallet's, regardless of any client-supplied
 * query parameter.
 *
 * Response shape is deliberately narrow — only the fields the UI
 * renders. We do NOT leak destination addresses, rate-lock values, or
 * raw memo strings; those are operator-side details.
 */

import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import { listConfirmedSessionsByWallet } from '@/lib/payment/history';
import { enforceRateLimit } from '@/lib/payment/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, 'payment.history');
  if (limited) return limited as unknown as NextResponse;

  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401 },
    );
  }

  const rows = listConfirmedSessionsByWallet(session.wallet);

  return NextResponse.json(
    {
      ok: true,
      sessions: rows.map((r) => ({
        sessionId: r.session_id,
        tier: r.tier,
        cadence: r.cadence,
        chain: r.chain,
        token: r.token,
        amount: r.amount,
        decimals: r.decimals,
        amountUsdCents: r.amount_usd_cents,
        confirmedAt: r.confirmed_at,
        txSig: r.tx_sig,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
