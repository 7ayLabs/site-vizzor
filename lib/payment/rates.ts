/**
 * USD-to-token rate snapshotter for the checkout flow.
 *
 * Source priority (highest authority first):
 *   1. **Vizzor engine** `${VIZZOR_API_URL}/v1/market/prices?symbols=…`
 *      — Binance-aggregated, same prices the AI uses to size trades.
 *      This is the path the ticker route already trusts; sharing it
 *      with the checkout means the rate the user pays at matches the
 *      rate they see quoted everywhere else on the surface.
 *   2. **CoinGecko** — best-effort fallback when the engine is
 *      unreachable. CoinGecko's free tier rate-limits aggressively
 *      (10–30 req/min per IP); a single VPS-bound fleet can blow
 *      through the budget under load. We keep it as a backup, not the
 *      primary, so a 429 here doesn't 503 every checkout.
 *   3. **Stale cache** — when both upstreams fail and the last
 *      successful fetch is within `STALE_GRACE_MS`, we return the
 *      stale value rather than null. The checkout watcher validates
 *      the on-chain amount against the rate that's snapshotted INTO
 *      the session row at create time, so a slightly stale rate
 *      doesn't break settlement — it only widens the slippage band
 *      for the user, who can always re-checkout after the 5-min rate
 *      lock expires.
 *
 * USDC is pegged 1:1 so no network call.
 *
 * Dev overrides:
 *   NEXT_PUBLIC_SOL_MOCK_USD   — bypass upstreams for SOL
 *   NEXT_PUBLIC_TON_MOCK_USD   — bypass upstreams for TON
 */

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3/simple/price';
const VIZZOR_API_BASE =
  process.env.VIZZOR_API_URL ??
  process.env.NEXT_PUBLIC_VIZZOR_API_URL ??
  'https://api.vizzor.ai';
const CACHE_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;
/** Grace window where a stale cached rate is acceptable as a last
 *  resort when every live upstream fails. 5 minutes mirrors the
 *  checkout rate-lock window (`paymentRateLockSeconds`), so any rate
 *  we hand back is at worst lock-aligned. */
const STALE_GRACE_MS = 5 * 60_000;

export type PriceToken = 'sol' | 'ton' | 'usdc';

export interface CachedRate {
  token: PriceToken;
  /** USD per 1 token unit, at `at`. */
  usdPer: number;
  /** Epoch millis when the rate was fetched. */
  at: number;
}

const cache = new Map<PriceToken, CachedRate>();

const COINGECKO_IDS: Record<PriceToken, string> = {
  sol: 'solana',
  ton: 'the-open-network',
  usdc: 'usd-coin',
};

/** Mapping from our PriceToken to the engine's market symbol. */
const ENGINE_SYMBOLS: Record<PriceToken, string | null> = {
  sol: 'SOL',
  ton: 'TON',
  usdc: null,
};

const MOCK_ENV: Record<PriceToken, string> = {
  sol: 'NEXT_PUBLIC_SOL_MOCK_USD',
  ton: 'NEXT_PUBLIC_TON_MOCK_USD',
  usdc: 'NEXT_PUBLIC_USDC_MOCK_USD',
};

export async function getRate(token: PriceToken): Promise<CachedRate | null> {
  const now = Date.now();
  const hit = cache.get(token);
  if (hit && now - hit.at < CACHE_MS) return hit;

  // USDC is a USD-pegged stablecoin; treat as 1.00 with no oracle dep.
  if (token === 'usdc') {
    const fresh: CachedRate = { token: 'usdc', usdPer: 1, at: now };
    cache.set(token, fresh);
    return fresh;
  }

  const fresh = await fetchRate(token);
  if (fresh) {
    cache.set(token, fresh);
    return fresh;
  }
  // Stale-while-error: a 5-minute-old SOL/TON quote is good enough to
  // keep checkout flowing. Without this the user gets a hard 503
  // every time CoinGecko hiccups, even though our previous value was
  // a minute old. The watcher validates against the locked rate, not
  // a live one, so the trade-off lands on the buyer's side as a tiny
  // slippage band — same as any 5-minute rate lock.
  if (hit && now - hit.at < STALE_GRACE_MS) return hit;
  return null;
}

interface EnginePriceRow {
  price?: unknown;
}
interface EnginePricesResponse {
  prices?: Record<string, EnginePriceRow>;
}

/**
 * Pull USD/token from the Vizzor engine's market route. Same upstream
 * the chat ticker uses, so checkout and chat agree on the price.
 * Returns null on any non-2xx, network failure, or missing field —
 * callers must fall back to the next source.
 */
async function fetchFromVizzor(token: PriceToken): Promise<CachedRate | null> {
  const symbol = ENGINE_SYMBOLS[token];
  if (!symbol) return null;
  const url = `${VIZZOR_API_BASE}/v1/market/prices?symbols=${encodeURIComponent(symbol)}`;
  const apiKey = process.env.VIZZOR_API_KEY;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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
    const json = (await res.json()) as EnginePricesResponse;
    const row = json.prices?.[symbol];
    if (!row) return null;
    const usd = typeof row.price === 'number' ? row.price : null;
    if (usd === null || !Number.isFinite(usd) || usd <= 0) return null;
    return { token, usdPer: usd, at: Date.now() };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFromCoinGecko(
  token: PriceToken,
): Promise<CachedRate | null> {
  const coingeckoId = COINGECKO_IDS[token];
  const url = `${COINGECKO_BASE}?ids=${coingeckoId}&vs_currencies=usd`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<
      string,
      { usd?: number } | undefined
    >;
    const usd = data[coingeckoId]?.usd;
    if (typeof usd !== 'number' || usd <= 0) return null;
    return { token, usdPer: usd, at: Date.now() };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRate(token: PriceToken): Promise<CachedRate | null> {
  const mock = process.env[MOCK_ENV[token]];
  if (mock) {
    const n = Number.parseFloat(mock);
    if (Number.isFinite(n) && n > 0) {
      return { token, usdPer: n, at: Date.now() };
    }
  }

  // Primary — engine (same Binance-aggregated source the AI uses).
  const fromEngine = await fetchFromVizzor(token);
  if (fromEngine) return fromEngine;
  // Fallback — CoinGecko direct. Best-effort.
  return fetchFromCoinGecko(token);
}

export function toTokenAmount(usd: number, rate: CachedRate): number {
  return Math.round((usd / rate.usdPer) * 10000) / 10000;
}
