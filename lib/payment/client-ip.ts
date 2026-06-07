/**
 * Client-IP resolution — single source of truth for every route that
 * needs to identify a caller for rate-limiting or audit purposes.
 *
 * The raw IP is **never persisted** anywhere. Callers either feed it
 * straight to `hashClientIp()` (rate-limit bucket key, audit-log
 * subject) or compare it in-memory and drop it. Storing client IPs
 * raw is a GDPR data-controller risk the project explicitly avoids.
 *
 * Resolution order:
 *   1. `x-forwarded-for` — first hop is the original client when the
 *      reverse proxy (Caddy / nginx in front of the VPS) appends to
 *      the chain. Trust this only because the production deploy
 *      controls the proxy; behind an untrusted proxy this header is
 *      spoofable and should be ignored.
 *   2. `x-real-ip` — Caddy / nginx synonym; some setups set only this.
 *   3. `cf-connecting-ip` — Cloudflare. Not on the current production
 *      path but cheap to support if we ever front with CF.
 *   4. Fallback constant `'unknown'`. We bucket those into a single
 *      rate-limit slot — a degraded but safe default.
 */

import { createHmac } from 'node:crypto';

const RATE_LIMIT_SALT_ENV = 'VIZZOR_RATE_LIMIT_SALT';

/**
 * Extract the best-effort client IP from request headers. Never throws.
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  return 'unknown';
}

/**
 * Hash the client IP with the project's rate-limit salt so the value
 * stored in `rate_limit_buckets.key` or `audit_log.ip_hash` is not
 * itself PII. HMAC-SHA-256 truncated to 16 bytes is sufficient: the
 * collision space for legitimate rate-limit buckets is small (route ×
 * IP), and the security goal is non-reversibility, not collision
 * resistance against an adversary who already knows the IP.
 *
 * Fail-soft: if the salt env is unset we emit a fixed string that
 * lumps every caller into one bucket — degraded rate-limiting, but
 * doesn't crash the request. The deploy runbook flags this in prod.
 */
export function hashClientIp(ip: string): string {
  const salt = process.env[RATE_LIMIT_SALT_ENV] ?? '';
  if (salt.length === 0) {
    return 'unsalted';
  }
  return createHmac('sha256', salt).update(ip).digest('hex').slice(0, 32);
}
