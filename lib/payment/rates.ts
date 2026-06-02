/**
 * USD-to-token rate snapshotter for the checkout flow.
 *
 * Supports two Phase-1 tokens: TON (via CoinGecko) and $VIZZOR (via
 * the engine's price feed — which proxies Jupiter / Birdeye internally
 * once the token is launched). For now $VIZZOR is feature-flagged and
 * returns a fixed mock price for development.
 *
 * Both sources are cached for 60s server-side. The actual locked rate
 * used by the engine to validate the on-chain amount is snapshotted
 * inside the session record on createSession, not by these helpers.
 */

const COINGECKO_TON =
  'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd';
const CACHE_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;

export type PriceToken = 'ton' | 'vizzor';

export interface CachedRate {
  token: PriceToken;
  /** USD per 1 token unit, at `at`. */
  usdPer: number;
  /** Epoch millis when the rate was fetched. */
  at: number;
}

const cache = new Map<PriceToken, CachedRate>();

export async function getRate(token: PriceToken): Promise<CachedRate | null> {
  const now = Date.now();
  const hit = cache.get(token);
  if (hit && now - hit.at < CACHE_MS) return hit;

  const fresh = await fetchRate(token);
  if (fresh) {
    cache.set(token, fresh);
    return fresh;
  }
  // stale-while-error
  return hit ?? null;
}

async function fetchRate(token: PriceToken): Promise<CachedRate | null> {
  if (token === 'ton') return fetchTonRate();
  return fetchVizzorRate();
}

async function fetchTonRate(): Promise<CachedRate | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(COINGECKO_TON, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<
      string,
      { usd?: number } | undefined
    >;
    const usd = data['the-open-network']?.usd;
    if (typeof usd !== 'number' || usd <= 0) return null;
    return { token: 'ton', usdPer: usd, at: Date.now() };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * $VIZZOR price lookup. Once the token launches, this proxies the
 * engine's `/v1/market/price/VIZZOR` endpoint which aggregates
 * Jupiter + Birdeye internally. Until then, we honor the env override
 * `NEXT_PUBLIC_VIZZOR_MOCK_USD` so dev/staging can simulate any price.
 */
async function fetchVizzorRate(): Promise<CachedRate | null> {
  const mock = process.env.NEXT_PUBLIC_VIZZOR_MOCK_USD;
  if (mock) {
    const n = Number.parseFloat(mock);
    if (Number.isFinite(n) && n > 0) {
      return { token: 'vizzor', usdPer: n, at: Date.now() };
    }
  }

  const base =
    process.env.VIZZOR_API_URL ??
    process.env.NEXT_PUBLIC_VIZZOR_API_URL ??
    'https://api.vizzor.ai';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/v1/market/price/VIZZOR`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { price?: number };
    if (typeof data.price !== 'number' || data.price <= 0) return null;
    return { token: 'vizzor', usdPer: data.price, at: Date.now() };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function toTokenAmount(usd: number, rate: CachedRate): number {
  return Math.round((usd / rate.usdPer) * 100) / 100;
}
