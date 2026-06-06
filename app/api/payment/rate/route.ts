/**
 * GET /api/payment/rate — live USD-to-SOL rate for the checkout
 * preview. 60s in-memory cache (see lib/payment/rates.ts).
 *
 * Returns 503 with `reason: 'rate_unavailable'` if upstream is
 * unreachable AND no fresh cache exists — the UI then shows
 * "rate unavailable" rather than fabricating a price.
 */

import { NextResponse } from 'next/server';
import { getRate } from '@/lib/payment/rates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const rate = await getRate('sol');
  if (!rate) {
    return NextResponse.json(
      { ok: false, reason: 'rate_unavailable', token: 'sol' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return NextResponse.json(
    { ok: true, token: rate.token, usdPer: rate.usdPer, at: rate.at },
    {
      headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' },
    },
  );
}
