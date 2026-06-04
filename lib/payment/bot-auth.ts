/**
 * Shared-secret auth for site-to-bot HTTP routes (v0.2.0).
 *
 * The bot calls a small set of site endpoints — grant redemption,
 * subscription lookup, and bot-initiated wallet link — and authenticates
 * with the `x-vizzor-bot-token` header. The expected value is the
 * `VIZZOR_BOT_SHARED_SECRET` env var.
 *
 * Semantics, per RFC §7:
 *
 *   - Production (`NODE_ENV === 'production'`) fail-closed when the env
 *     is unset: every call returns `unauthorized` (the route then maps
 *     to a 401). The site never silently accepts unauthenticated bot
 *     requests in prod.
 *   - Non-production allow-soft when the env is unset: every call
 *     returns `ok`, accompanied by a one-shot `console.warn` so a
 *     developer notices that the bot auth is wide open locally. This
 *     keeps the dev loop frictionless without requiring every
 *     contributor to provision a real secret.
 *   - Comparison is constant-time via `crypto.timingSafeEqual` to avoid
 *     a side-channel that distinguishes "wrong secret" from "no secret"
 *     based on response latency.
 *   - The shared secret itself is never logged. Routes that log auth
 *     decisions should log a boolean `accepted` flag only.
 *
 * The RFC §7 rotation procedure introduces `VIZZOR_BOT_SHARED_SECRET_NEXT`
 * as a second-accepted value during a deploy window. This helper accepts
 * either secret when both are configured, which makes step 2 of the
 * rotation (deploy new secret to the site first, then to the bot) a
 * zero-downtime operation.
 */

import { timingSafeEqual } from 'node:crypto';

const HEADER = 'x-vizzor-bot-token';
const ENV_PRIMARY = 'VIZZOR_BOT_SHARED_SECRET';
const ENV_NEXT = 'VIZZOR_BOT_SHARED_SECRET_NEXT';

export type BotAuthResult =
  | { ok: true }
  | { ok: false; reason: 'missing_header' | 'unauthorized' };

let warnedDevUnsecured = false;

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Constant-time compare two strings. Returns false on any length
 * mismatch (length is not secret because both lengths are constants on
 * each side of the rotation) without allocating a longer buffer than
 * needed. Inputs that contain non-UTF-8 bytes never appear here — the
 * header value is a base64url token by convention and the env var is
 * operator-provisioned ASCII.
 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Validate the bot shared-secret header on an inbound request.
 *
 * The header lookup is case-insensitive (Node's `Headers` class
 * normalizes for us). An empty string is treated as missing because a
 * proxy that strips the value but preserves the header name should not
 * accidentally authenticate.
 */
export function requireBotSecret(req: Request): BotAuthResult {
  const header = req.headers.get(HEADER) ?? '';
  if (header.length === 0) {
    return { ok: false, reason: 'missing_header' };
  }

  const primary = process.env[ENV_PRIMARY] ?? '';
  const next = process.env[ENV_NEXT] ?? '';

  if (primary.length === 0 && next.length === 0) {
    if (isProd()) {
      // Fail-closed: prod must be configured. The route returns 401
      // (same shape as a wrong secret) and `/api/health` is expected
      // to expose `bot_auth_configured: false` so monitoring catches
      // the misconfiguration within the health-check window.
      return { ok: false, reason: 'unauthorized' };
    }
    if (!warnedDevUnsecured) {
      warnedDevUnsecured = true;
      // One-shot warning: dev mode allow-soft. Surfaced once per
      // Node process so the noise floor in local logs stays low.
      // eslint-disable-next-line no-console
      console.warn(
        '[bot-auth] VIZZOR_BOT_SHARED_SECRET is unset; accepting all ' +
          'x-vizzor-bot-token headers in non-production. Provision the ' +
          'secret before deploying to production.',
      );
    }
    return { ok: true };
  }

  if (primary.length > 0 && safeEqual(header, primary)) return { ok: true };
  if (next.length > 0 && safeEqual(header, next)) return { ok: true };
  return { ok: false, reason: 'unauthorized' };
}

/**
 * Translate an auth failure to the canonical wire shape returned by
 * every bot-authenticated route. Centralised so the contract docs in
 * `API_CONTRACT.md` are reflected by exactly one source.
 */
export function botAuthFailureBody(
  reason: Exclude<BotAuthResult, { ok: true }>['reason'],
): { ok: false; reason: 'unauthorized' } {
  // We deliberately collapse both internal reasons to the same public
  // reason. The site does not tell a caller whether the header was
  // absent or wrong — that's a small but real defense against probing.
  void reason;
  return { ok: false, reason: 'unauthorized' };
}
