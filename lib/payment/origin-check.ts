/**
 * Origin defense-in-depth for mutating routes.
 *
 * Modern browsers already prevent the classic CSRF flow because every
 * mutating auth/payment route is gated by a `SameSite=Lax|Strict`
 * cookie that a cross-origin POST cannot smuggle. This module adds a
 * second layer: if an `Origin` header is present, it must equal one
 * of our canonical origins. The Origin header is browser-set and
 * cannot be forged from a malicious page on a different host.
 *
 * Behavior:
 *   - Missing `Origin` (server-to-server, curl, Telegram bot) → pass.
 *     We trust the route's other auth gates (bot shared secret, SIWS
 *     session) for those callers.
 *   - Present and matches → pass.
 *   - Present and doesn't match → reject with 403.
 *
 * Allowed origins:
 *   - `https://vizzor.ai`, `https://www.vizzor.ai`, and the product
 *     shell host `https://app.vizzor.ai` in production.
 *   - Any localhost / 127.0.0.1 on non-production for the dev loop.
 *   - `VIZZOR_EXTRA_ORIGINS` env (comma-separated) for staging URLs.
 */

const PROD_ORIGINS = new Set<string>([
  'https://vizzor.ai',
  'https://www.vizzor.ai',
  'https://app.vizzor.ai',
]);

function isLocalDevOrigin(origin: string): boolean {
  // Accept any scheme/host pair that looks like a dev rig.
  return (
    /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
    /^https?:\/\/\[::1\](:\d+)?$/.test(origin)
  );
}

function extraOrigins(): Set<string> {
  const raw = process.env.VIZZOR_EXTRA_ORIGINS ?? '';
  if (raw.length === 0) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export type OriginCheckResult =
  | { ok: true }
  | { ok: false; reason: 'origin_forbidden' };

/**
 * Validate that the request's `Origin` header (if present) matches an
 * allowed origin. Returns `{ ok: true }` for any request that does
 * not carry the header — that's expected for server-to-server callers
 * and the route's primary auth gate handles them.
 */
export function checkOrigin(req: Request): OriginCheckResult {
  const origin = req.headers.get('origin');
  if (!origin) return { ok: true };

  if (process.env.NODE_ENV === 'production') {
    if (PROD_ORIGINS.has(origin)) return { ok: true };
    if (extraOrigins().has(origin)) return { ok: true };
    return { ok: false, reason: 'origin_forbidden' };
  }

  // Non-production: accept localhost variants + any explicit extras.
  if (isLocalDevOrigin(origin)) return { ok: true };
  if (extraOrigins().has(origin)) return { ok: true };
  if (PROD_ORIGINS.has(origin)) return { ok: true };
  return { ok: false, reason: 'origin_forbidden' };
}
