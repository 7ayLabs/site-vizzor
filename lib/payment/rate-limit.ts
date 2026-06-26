/**
 * Per-IP token-bucket rate-limiter — SQLite-backed.
 *
 * Why SQLite, not Redis: the deployment is single-VPS, the QPS ceiling
 * for any individual route is sub-100/s in steady state, and adding a
 * Redis dependency triples the operational surface. better-sqlite3's
 * synchronous in-process writes are faster than a Redis hop until we
 * outscale a single node. When we do, the bucket table migrates to a
 * managed cache without touching the public API of `takeToken()`.
 *
 * Bucket model:
 *   - key = "{route}:{hashed-ip}" — opaque, never PII.
 *   - tokens = current credit (float, refills continuously).
 *   - capacity / refillPerSecond come from the route config.
 *   - On each call: refill = (now - last_refill_at) * refillPerSecond,
 *     clamp to capacity, subtract 1 → check ≥ 0.
 *
 * Fail-closed: if the SQL throws (disk full, lock contention) we deny
 * the request. A bucket query that mysteriously stops working is a
 * far worse fail-open than a brief 429 storm.
 *
 * Stored values:
 *   - The key is `{route-prefix}:{hashClientIp(ip)}` where the IP hash
 *     is HMAC-SHA-256 truncated to 16 bytes (see `client-ip.ts`).
 *   - Reads at the route boundary; expired rows are reclaimed by the
 *     retention sweep (Layer C).
 */

import { getDb } from './db';
import { getClientIp, hashClientIp } from './client-ip';

export interface RateLimitConfig {
  /** Tokens the bucket holds when full. */
  capacity: number;
  /** Tokens added per second of real time. */
  refillPerSecond: number;
}

/**
 * Canonical per-route rate-limit ceilings. Tuned for the v0.2.x
 * threat model: enough headroom for legitimate retry storms, tight
 * enough to make enumeration / nonce-grinding visibly painful.
 */
export const ROUTE_LIMITS: Readonly<Record<string, RateLimitConfig>> = {
  // 10 req/min — defends nonce grinding while leaving room for retries.
  'auth.siws.nonce': { capacity: 10, refillPerSecond: 10 / 60 },
  // 20 req/min — wallet may retry signing a few times.
  'auth.siws.verify': { capacity: 20, refillPerSecond: 20 / 60 },
  // 20 req/min — modal pre-allocates 2 handoffs (phantom + solflare)
  // per open; user may retry on iOS where the gesture window is
  // tight. The cap absorbs that without inviting enumeration.
  'auth.mobile-handoff.create': { capacity: 20, refillPerSecond: 20 / 60 },
  // 40 req/min — the callback redeem fires once per round-trip leg
  // (connect + sign = 2). Slightly higher cap because retries on
  // flaky mobile networks land here disproportionately.
  'auth.mobile-handoff.redeem': { capacity: 40, refillPerSecond: 40 / 60 },
  // 30 req/min — checkout shell retries on transient errors.
  'payment.session': { capacity: 30, refillPerSecond: 30 / 60 },
  // 5 req/s — legitimate bot bursts (many users hitting /start).
  'grants.redeem': { capacity: 10, refillPerSecond: 5 },
  'subscriptions.lookup': { capacity: 10, refillPerSecond: 5 },
  'wallet-links.write': { capacity: 10, refillPerSecond: 5 },
  // 600 req/min, sustained 10/s — Phase 1 (Report-Only) routinely
  // bursts beyond 60/min when a single misconfigured directive fires
  // dozens of reports per page load. The previous 60/min cap silenced
  // the diagnostic channel after a few page views, which defeats the
  // purpose of Report-Only. Bound is still well below an actual DoS.
  'security.csp-report': { capacity: 600, refillPerSecond: 10 },
  // 30 req/min — payment history is wallet-scoped + SIWS-gated; the
  // limit is defense-in-depth against enumeration attempts on the
  // SQLite probe path. /app/billing polls at most every 20s, so 30/min
  // gives well over 3× headroom for legitimate use.
  'payment.history': { capacity: 30, refillPerSecond: 30 / 60 },
  // 60 req/min — alerts list is polled by /app/alerts every 30s
  // (~2 req/min for a normal user). Cap at 60 gives 30× headroom and
  // catches scrapers without inconveniencing real users.
  'alerts.read': { capacity: 60, refillPerSecond: 60 / 60 },
  // 10 req/min — arm/cancel are user-driven; a Pro user wouldn't
  // legitimately fire more than a handful in a sitting. Tight cap
  // also blunts the cost of bot-driven spam against the engine.
  'alerts.write': { capacity: 10, refillPerSecond: 10 / 60 },
  // 30 req/min — account-delete is rare but should not enumerate.
  'account.delete': { capacity: 30, refillPerSecond: 0.5 },
  // 5 req/min — retention sweep is server-side cron, low frequency.
  'internal.retention-sweep': { capacity: 5, refillPerSecond: 5 / 60 },
  // Per-wallet burst limit on /predict. 1 token, refills every 5s →
  // a single wallet can fire at most 12 predictions/minute. This is
  // the burst shield in front of the daily cap (Layer 3 of the cost
  // shield). Keyed on the SIWS-bound wallet, not the IP, so a NAT'd
  // user behind a shared IP isn't unfairly penalized.
  'predict.burst': { capacity: 1, refillPerSecond: 1 / 5 },
};

export type RateLimitResult =
  | { ok: true; remaining: number }
  | {
      ok: false;
      reason: 'rate_limited' | 'unconfigured';
      retryAfterSeconds: number;
    };

interface BucketRow {
  tokens: number;
  last_refill_at: number;
}

/**
 * Attempt to take one token from the (route, ip) bucket.
 *
 * Returns `{ ok: true, remaining }` on success and updates the row.
 * Returns `{ ok: false, reason: 'rate_limited', retryAfterSeconds }`
 * if the bucket is empty. The retry hint is the time-to-1-token at
 * the configured refill rate, rounded up.
 */
export function takeToken(
  routeKey: keyof typeof ROUTE_LIMITS,
  ip: string,
): RateLimitResult {
  const config = ROUTE_LIMITS[routeKey];
  if (!config) {
    return { ok: false, reason: 'unconfigured', retryAfterSeconds: 60 };
  }
  const ipHash = hashClientIp(ip);
  const key = `${routeKey}:${ipHash}`;
  const now = Date.now();

  try {
    const db = getDb();
    const tx = db.transaction(() => {
      const existing = db
        .prepare<[string], BucketRow>(
          `SELECT tokens, last_refill_at FROM rate_limit_buckets WHERE key = ?`,
        )
        .get(key);

      let tokens: number;
      if (!existing) {
        // First touch — start full, minus the one we're about to take.
        tokens = config.capacity - 1;
        db.prepare(
          `INSERT INTO rate_limit_buckets (key, tokens, last_refill_at)
           VALUES (?, ?, ?)`,
        ).run(key, tokens, now);
        return { remaining: tokens };
      }

      const elapsedSeconds = Math.max(0, (now - existing.last_refill_at) / 1000);
      const refilled = Math.min(
        config.capacity,
        existing.tokens + elapsedSeconds * config.refillPerSecond,
      );

      if (refilled < 1) {
        // Bucket empty. Don't update — preserves the refill ratchet
        // for the legitimate next call.
        const deficit = 1 - refilled;
        const retryAfterSeconds = Math.ceil(deficit / config.refillPerSecond);
        return { rateLimited: true, retryAfterSeconds };
      }

      tokens = refilled - 1;
      db.prepare(
        `UPDATE rate_limit_buckets SET tokens = ?, last_refill_at = ?
         WHERE key = ?`,
      ).run(tokens, now, key);
      return { remaining: tokens };
    });

    const result = tx() as
      | { remaining: number }
      | { rateLimited: true; retryAfterSeconds: number };

    if ('rateLimited' in result) {
      return {
        ok: false,
        reason: 'rate_limited',
        retryAfterSeconds: result.retryAfterSeconds,
      };
    }
    return { ok: true, remaining: Math.floor(result.remaining) };
  } catch {
    // Fail-closed: a broken bucket SQL is treated as rate-limited
    // rather than silently allowing the request through.
    return { ok: false, reason: 'rate_limited', retryAfterSeconds: 60 };
  }
}

/**
 * Convenience wrapper for routes: pull the IP off the request, take a
 * token, and on rejection return a ready-to-`return` Response.
 *
 * On success the route continues; the route does not need to read the
 * remaining count for its body — it's returned as a header by some
 * future operator dashboard if wanted.
 */
export function enforceRateLimit(
  req: Request,
  routeKey: keyof typeof ROUTE_LIMITS,
): Response | null {
  const ip = getClientIp(req);
  const result = takeToken(routeKey, ip);
  if (result.ok) return null;
  const headers = new Headers({
    'content-type': 'application/json',
    'retry-after': String(result.retryAfterSeconds),
    'cache-control': 'no-store',
  });
  return new Response(
    JSON.stringify({
      ok: false,
      reason: result.reason,
      retryAfterSeconds: result.retryAfterSeconds,
    }),
    { status: 429, headers },
  );
}

/**
 * Wallet-keyed variant of `takeToken`. Used by the predict route's
 * burst shield (Layer 3 of the cost protection) — a single SIWS-bound
 * wallet can't bypass the limit by switching IPs (mobile networks
 * rotate) and a NAT'd corp network of legit users isn't penalized for
 * sharing an IP. The wallet is hashed via the same `hashClientIp`
 * primitive so the bucket key stays opaque (no raw wallet stored).
 */
export function takeTokenForWallet(
  routeKey: keyof typeof ROUTE_LIMITS,
  wallet: string,
): RateLimitResult {
  // The hash primitive accepts any string and is salted via the same
  // RATE_LIMIT_SALT env that protects the IP buckets — no new key
  // material to manage.
  return takeToken(routeKey, `wallet:${wallet}`);
}

/**
 * Convenience wrapper: take a wallet-keyed token; on rejection return
 * a ready-to-`return` 429 with `Retry-After`. Mirrors `enforceRateLimit`
 * but for the per-wallet shield.
 */
export function enforceWalletRateLimit(
  wallet: string,
  routeKey: keyof typeof ROUTE_LIMITS,
): Response | null {
  const result = takeTokenForWallet(routeKey, wallet);
  if (result.ok) return null;
  const headers = new Headers({
    'content-type': 'application/json',
    'retry-after': String(result.retryAfterSeconds),
    'cache-control': 'no-store',
  });
  return new Response(
    JSON.stringify({
      ok: false,
      error: 'burst_rate_limited',
      reason: result.reason,
      retryAfterSeconds: result.retryAfterSeconds,
    }),
    { status: 429, headers },
  );
}
