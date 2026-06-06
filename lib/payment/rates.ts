/**
 * USD-to-token rate snapshotter for the checkout flow.
 *
 * v0.2.0 ships Solana-native-only. The single supported token is SOL,
 * fetched from CoinGecko. The actual locked rate used by the watcher
 * to validate the on-chain amount is snapshotted inside the session
 * record on createSession, not by this helper.
 *
 * Dev override: NEXT_PUBLIC_SOL_MOCK_USD bypasses the network fetch
 * so local dev / CI doesn't depend on CoinGecko availability.
 */

const COINGECKO_SOL =
  'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd';
const CACHE_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;

export type PriceToken = 'sol';

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

  const fresh = await fetchSolRate();
  if (fresh) {
    cache.set(token, fresh);
    return fresh;
  }
  // stale-while-error
  return hit ?? null;
}

async function fetchSolRate(): Promise<CachedRate | null> {
  const mock = process.env.NEXT_PUBLIC_SOL_MOCK_USD;
  if (mock) {
    const n = Number.parseFloat(mock);
    if (Number.isFinite(n) && n > 0) {
      return { token: 'sol', usdPer: n, at: Date.now() };
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(COINGECKO_SOL, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<
      string,
      { usd?: number } | undefined
    >;
    const usd = data['solana']?.usd;
    if (typeof usd !== 'number' || usd <= 0) return null;
    return { token: 'sol', usdPer: usd, at: Date.now() };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function toTokenAmount(usd: number, rate: CachedRate): number {
  return Math.round((usd / rate.usdPer) * 10000) / 10000;
}
