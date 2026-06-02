/**
 * GET /api/payment/rate?token=ton|vizzor — live USD-to-token rate
 * for the checkout preview. 60s in-memory cache (see lib/payment/rates.ts).
 *
 * Defaults to `ton` so existing /pay/[tier]/[cadence] callers continue
 * to work without sending the param. Returns 503 with `reason:
 * 'rate_unavailable'` if upstream is unreachable AND no fresh cache
 * exists — the UI then shows "rate unavailable" rather than fabricating.
 */

import { NextResponse } from 'next/server';
import { getRate, type PriceToken } from '@/lib/payment/rates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function parseToken(url: URL): PriceToken {
  const raw = url.searchParams.get('token');
  return raw === 'vizzor' ? 'vizzor' : 'ton';
}

export async function GET(req: Request) {
  const token = parseToken(new URL(req.url));
  const rate = await getRate(token);
  if (!rate) {
    return NextResponse.json(
      { ok: false, reason: 'rate_unavailable', token },
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
