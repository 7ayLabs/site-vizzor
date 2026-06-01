/**
 * GET /api/payment/rate — current USD-to-TON rate for the checkout
 * preview. 60s in-memory cache (see lib/payment/rates.ts).
 */

import { NextResponse } from 'next/server';
import { getUsdPerTon } from '@/lib/payment/rates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const rate = await getUsdPerTon();
  if (!rate) {
    return NextResponse.json(
      { ok: false, reason: 'rate_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return NextResponse.json(
    { ok: true, usdPerTon: rate.usdPerTon, at: rate.at },
    {
      headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' },
    },
  );
}
