/**
 * GET /api/ticker — live ticker prices.
 *
 * Source priority (highest authority first):
 *   1. Vizzor engine `${VIZZOR_API_URL}/v1/market/prices?symbols=…`
 *      — Binance + CoinGecko aggregated upstream, same prices the AI
 *      sees when it composes trade plans. **This is the only path
 *      that prevents AI/UI price divergence.** If we serve a stale
 *      CoinGecko price here while the chat assistant uses Binance,
 *      users see "BTC at $63k" in the banner and "BTC at $61k" in the
 *      reply — the exact hallucination class we want to kill.
 *   2. CoinGecko direct — only used when the engine is unreachable
 *      AND the snapshot is too old. Best-effort polish, not a
 *      replacement for engine-authoritative pricing.
 *   3. Committed `data/snapshot.json` — never go blank.
 *
 * Cache: 30s (matches the SWR client poll cadence). One upstream hit
 * per minute per node regardless of visitor traffic.
 */

import { NextResponse } from 'next/server';
import { TOP_20 } from '@/lib/coin-meta';
import { getTicker as snapshotTicker } from '@/lib/snapshot';
import type { TickerEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VIZZOR_API_BASE =
  process.env.VIZZOR_API_URL ??
  process.env.NEXT_PUBLIC_VIZZOR_API_URL ??
  'https://api.vizzor.ai';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3/simple/price';
// Tight timeout on the engine fetch — if the engine doesn't have the
// market route deployed yet OR is offline, we want to fall through
// to CoinGecko fast rather than make the browser wait. 3s is the
// p99 of healthy engine responses in our staging logs.
const VIZZOR_TIMEOUT_MS = 3_000;
const COINGECKO_TIMEOUT_MS = 6_000;

interface VizzorPriceRow {
  price?: unknown;
  priceChange24h?: unknown;
  name?: unknown;
  volume24h?: unknown;
  marketCap?: unknown;
}
interface VizzorPricesResponse {
  prices?: Record<string, VizzorPriceRow>;
}

async function fetchFromVizzor(
  symbolList: ReadonlyArray<string>,
): Promise<TickerEntry[] | null> {
  const symbols = symbolList.join(',');
  const url = `${VIZZOR_API_BASE}/v1/market/prices?symbols=${encodeURIComponent(symbols)}`;
  const apiKey = process.env.VIZZOR_API_KEY;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VIZZOR_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as VizzorPricesResponse;
    if (!json.prices || typeof json.prices !== 'object') return null;

    const entries: TickerEntry[] = [];
    for (const symbol of symbolList) {
      const row = json.prices[symbol];
      if (!row) continue;
      const price = typeof row.price === 'number' ? row.price : null;
      if (price === null || !Number.isFinite(price) || price <= 0) continue;
      const change24h =
        typeof row.priceChange24h === 'number' ? row.priceChange24h : 0;
      entries.push({
        symbol,
        price,
        // Engine returns percent (e.g. -1.96), site stores fractional.
        changePct: change24h / 100,
        source: 'vizzor',
      });
    }
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

type CoinGeckoResponse = Record<
  string,
  { usd: number; usd_24h_change?: number }
>;

async function fetchFromCoinGecko(): Promise<TickerEntry[] | null> {
  const ids = TOP_20.map((c) => c.geckoId).join(',');
  const url = `${COINGECKO_BASE}?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COINGECKO_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
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

// Cap on how many ad-hoc symbols a caller can request in a single
// `?symbols=` query. The engine's /v1/market/prices accepts arbitrary
// lists; this guard protects us from a chatty client that crams every
// memecoin in the chat history into one round-trip.
const SYMBOLS_QUERY_MAX = 16;
const SYMBOL_RE = /^[A-Z0-9]{2,10}$/;

export async function GET(req: Request) {
  // Optional `?symbols=BTC,DASH,FOO` for lazy lookups beyond TOP_20.
  // The chat shell uses this to render inline ticker chips for any
  // coin the user mentions, not just the top-20. Unknown / malformed
  // symbols are dropped silently before the upstream fetch so a
  // crafted query can't fan out to junk endpoints.
  const url = new URL(req.url);
  const raw = url.searchParams.get('symbols');
  let symbolList: ReadonlyArray<string>;
  let isCustom = false;
  if (raw) {
    const requested = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => SYMBOL_RE.test(s));
    const deduped = Array.from(new Set(requested)).slice(0, SYMBOLS_QUERY_MAX);
    if (deduped.length === 0) {
      // Bad input → return an empty 200 (mirrors the empty-snapshot
      // fallback below) instead of 4xx so the client SWR resolves.
      return NextResponse.json([], {
        headers: { 'Cache-Control': 'no-store', 'x-vizzor-source': 'empty' },
      });
    }
    symbolList = deduped;
    isCustom = true;
  } else {
    symbolList = TOP_20.map((c) => c.symbol);
  }

  // Defensive: every fetcher already swallows its own errors and
  // returns null, but a throw in the snapshot getter or JSON path
  // would still 500 the route. Outer try/catch guarantees the
  // ticker endpoint NEVER returns a non-2xx — the UI relies on
  // `useTicker()` always resolving to a usable array.
  try {
    // 1. Vizzor engine — authoritative, matches what the AI sees.
    // No CDN caching: the engine already caches Binance for 15s, so
    // adding another 30s layer here drifts the widget away from what
    // the AI quotes in the same conversation. `no-store` means every
    // SWR poll hits the engine, the engine's own cache absorbs the
    // load against Binance.
    const fromVizzor = await fetchFromVizzor(symbolList);
    if (fromVizzor) {
      return NextResponse.json(fromVizzor, {
        headers: {
          'Cache-Control': 'no-store',
          'x-vizzor-source': 'engine',
        },
      });
    }
    // Custom-symbol queries skip the CoinGecko + snapshot fallbacks:
    // the snapshot only carries TOP_20 and CoinGecko's mapping is
    // also TOP_20-keyed. Returning empty (instead of a misleading
    // snapshot row) lets the client render gracefully ("no price
    // available yet") for the requested symbol.
    if (isCustom) {
      return NextResponse.json([], {
        headers: { 'Cache-Control': 'no-store', 'x-vizzor-source': 'empty' },
      });
    }
    // 2. CoinGecko direct — best-effort when engine is down.
    const fromGecko = await fetchFromCoinGecko();
    if (fromGecko) {
      return NextResponse.json(fromGecko, {
        headers: {
          'Cache-Control': 'no-store',
          'x-vizzor-source': 'coingecko',
        },
      });
    }
    // 3. Committed snapshot — never go blank.
    return NextResponse.json(snapshotTicker(), {
      headers: { 'Cache-Control': 'no-store', 'x-vizzor-source': 'snapshot' },
    });
  } catch {
    // Final guard: if even the snapshot getter throws (e.g. corrupt
    // bundled JSON), return an empty list with a 200 so the client
    // SWR resolves and the UI degrades to "no ticker" instead of
    // throwing a useSWR error.
    return NextResponse.json([], {
      status: 200,
      headers: { 'Cache-Control': 'no-store', 'x-vizzor-source': 'empty' },
    });
  }
}
