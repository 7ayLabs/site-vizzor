/**
 * USD-to-token rate snapshotter for the checkout flow.
 *
 * Supports SOL, TON, and USDC. USDC is pegged 1:1 so no network call.
 * SOL + TON pull from CoinGecko with a 60s cache + stale-while-error
 * fallback. The actual locked rate used by the watcher to validate
 * the on-chain amount is snapshotted inside the session row on
 * createSession, not by this helper.
 *
 * Dev overrides:
 *   NEXT_PUBLIC_SOL_MOCK_USD   — bypass CoinGecko for SOL
 *   NEXT_PUBLIC_TON_MOCK_USD   — bypass CoinGecko for TON
 */

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3/simple/price';
const CACHE_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;

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
  return hit ?? null;
}

async function fetchRate(token: PriceToken): Promise<CachedRate | null> {
  const mock = process.env[MOCK_ENV[token]];
  if (mock) {
    const n = Number.parseFloat(mock);
    if (Number.isFinite(n) && n > 0) {
      return { token, usdPer: n, at: Date.now() };
    }
  }

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

export function toTokenAmount(usd: number, rate: CachedRate): number {
  return Math.round((usd / rate.usdPer) * 10000) / 10000;
}
