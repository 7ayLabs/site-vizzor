/**
 * GET /api/ticker — live ticker prices for the homepage carousel.
 *
 * Server-side proxy to CoinGecko's free `simple/price` endpoint. Returns
 * the same `TickerEntry[]` shape the SWR client hook expects, so the
 * upstream change is invisible to the consumer.
 *
 * Why proxy instead of letting the client call CoinGecko directly:
 *  - CoinGecko free tier has a per-IP rate limit (~30 req/min). One
 *    server-side cache window covers every visitor on this VPS.
 *  - The CoinGecko response is keyed by gecko ID — we own the symbol→id
 *    mapping in `lib/coin-meta.ts` and translate it here so the client
 *    never needs to know about gecko IDs.
 *  - Avoids exposing third-party endpoints in the browser network panel.
 *
 * On any upstream error or timeout we fall back to the committed
 * `data/snapshot.json` ticker so the carousel never goes blank.
 *
 * Cached for 30 seconds via `next.revalidate`, which is the same cadence
 * the client SWR hook polls at. So we hit CoinGecko at most twice per
 * minute regardless of traffic.
 */

import { NextResponse } from 'next/server';
import { TOP_20 } from '@/lib/coin-meta';
import { getTicker as snapshotTicker } from '@/lib/snapshot';
import type { TickerEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3/simple/price';
const FETCH_TIMEOUT_MS = 6_000;

type CoinGeckoResponse = Record<
  string,
  { usd: number; usd_24h_change?: number }
>;

async function fetchLive(): Promise<TickerEntry[] | null> {
  const ids = TOP_20.map((c) => c.geckoId).join(',');
  const url = `${COINGECKO_BASE}?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as CoinGeckoResponse;

    const entries: TickerEntry[] = TOP_20
      .map((coin): TickerEntry | null => {
        const row = data[coin.geckoId];
        if (!row || typeof row.usd !== 'number') return null;
        return {
          symbol: coin.symbol,
          price: row.usd,
          changePct:
            typeof row.usd_24h_change === 'number'
              ? row.usd_24h_change / 100
              : 0,
          source: 'coingecko',
        };
      })
      .filter((e): e is TickerEntry => e !== null);

    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const live = await fetchLive();
  if (live) {
    return NextResponse.json(live, {
      headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' },
    });
  }
  // Fall back to the committed snapshot so the ticker never goes blank.
  return NextResponse.json(snapshotTicker(), {
    headers: { 'Cache-Control': 'no-store', 'x-vizzor-fallback': 'snapshot' },
  });
}
