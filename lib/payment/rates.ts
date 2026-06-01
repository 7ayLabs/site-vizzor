/**
 * USD-to-TON rate snapshotter for the checkout flow.
 *
 * The flow:
 *   1. Visitor lands on /pay/[tier]/[cadence] — UI calls /api/payment/rate
 *      to display a live preview ("You'll pay ~24.3 TON for $99").
 *   2. When they click "Connect & Pay", the rate is snapshotted into the
 *      session record. The watcher daemon validates the on-chain amount
 *      against that snapshot (±0.5% slippage tolerance), not the spot
 *      price at confirmation time.
 *
 * The /api/payment/rate endpoint is a thin proxy to CoinGecko's free
 * simple-price endpoint (same upstream the ticker carousel uses). 60s
 * in-memory cache so the checkout page doesn't hammer CoinGecko if a
 * visitor reloads.
 */

const COINGECKO_PRICE =
  'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd';
const CACHE_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;

interface CachedRate {
  /** USD per 1 TON, at `at`. */
  usdPerTon: number;
  /** Epoch millis when the rate was fetched. */
  at: number;
}

let cached: CachedRate | null = null;

/**
 * Returns the current USD/TON rate, cached for 60 seconds. Returns
 * null if upstream is unreachable AND no fresh cache is available —
 * the caller must handle that (the checkout shows "rate unavailable,
 * retry" rather than fabricating a number).
 */
export async function getUsdPerTon(): Promise<CachedRate | null> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(COINGECKO_PRICE, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return cached; // stale-while-error
    const data = (await res.json()) as Record<
      string,
      { usd?: number } | undefined
    >;
    const usd = data['the-open-network']?.usd;
    if (typeof usd !== 'number' || usd <= 0) return cached;
    cached = { usdPerTon: usd, at: now };
    return cached;
  } catch {
    return cached;
  } finally {
    clearTimeout(timeout);
  }
}

/** Convert a USD amount to TON using the current cached rate. */
export function usdToTon(usd: number, rate: CachedRate): number {
  return Math.round((usd / rate.usdPerTon) * 100) / 100; // 2 decimals
}
