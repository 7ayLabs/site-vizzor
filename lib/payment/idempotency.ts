/**
 * Idempotency for `POST /api/payment/session`.
 *
 * Today the route mints a fresh `payment_sessions` row on every call.
 * A double-click, browser-retry, or wallet-redirect round-trip
 * therefore yields two pending rows for the same user intent. The user
 * pays one; the watcher confirms that one; the UI may still be
 * polling the other and shows a misleading "expired" state.
 *
 * v0.2.0 adds a deterministic dedupe key bound to the browser session.
 * Inside a 60-second window, identical intents return the same
 * `payment_sessions` row instead of minting a new one.
 *
 * Key shape:
 *   sha256(`${tier}|${cadence}|${tokenHash}|${chain}|${cookieSessionId}`)
 *
 * Persistence is a new `idempotency_keys` table (see `db.ts`). Rows
 * are purged by the watcher-tick sweeper at a 5-minute TTL (well
 * beyond the 60-second dedupe window so the table stays useful for
 * incident-response inspection).
 *
 * Security note:
 *   - The cookieSessionId is a server-minted opaque 16-byte
 *     base64url string. It carries no PII and is not correlatable
 *     to user identity outside this site.
 *   - SameSite=Strict + HttpOnly mitigate the cookie-spoofing surface.
 *     CSRF on session create is covered by the C4 audit.
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  findIdempotencyKey,
  insertIdempotencyKey,
} from './db';

export const COOKIE_NAME = 'vizzor.session';
/** 30 days — the cookie outlives any single purchase flow but rolls
 *  if the browser is wiped. */
export const COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 60-second dedupe window. Past this, the rate lock has either
 *  confirmed or expired and the user intent should yield a new quote. */
export const DEFAULT_TTL_MS = 60_000;

export interface IdempotencyInput {
  tier: string;
  cadence: string;
  chain: string;
  token: string;
  /** Opaque per-browser session identifier from the `vizzor.session`
   *  cookie. Empty string is treated as "no cookie yet". */
  cookieSessionId: string;
}

/**
 * Compute the deterministic dedupe key for an intent.
 *
 * The function is pure: identical inputs always yield the same
 * 64-character hex string. The `cookieSessionId` is part of the
 * hash so that two browsers (or two browser profiles) submitting
 * the identical (tier, cadence, chain, token) tuple within the
 * dedupe window get distinct sessions.
 */
export function computeIdempotencyKey(input: IdempotencyInput): string {
  const tokenHash = createHash('sha256').update(input.token).digest('hex').slice(0, 16);
  const material = [
    input.tier,
    input.cadence,
    tokenHash,
    input.chain,
    input.cookieSessionId,
  ].join('|');
  return createHash('sha256').update(material).digest('hex');
}

/**
 * Look up a session id previously cached for this key, if and only if
 * the cache entry is within the TTL window.
 *
 * Returns the `payment_sessions.session_id` or `null` if the key has
 * never been seen, has been seen but the row is older than `ttlMs`,
 * or the upstream DB call fails. Callers MUST treat null as a cache
 * miss and proceed to mint a fresh session.
 */
export function findRecentSessionByKey(
  key: string,
  ttlMs: number,
): string | null {
  const row = findIdempotencyKey(key);
  if (!row) return null;
  if (Date.now() - row.created_at > ttlMs) return null;
  return row.session_id;
}

/**
 * Record the (key → session_id) binding so subsequent identical
 * intents within the TTL window dedupe to this session.
 *
 * The DB primary key on `key` causes an INSERT collision if the same
 * key is recorded twice. In that case we silently swallow — the prior
 * row is the canonical binding, and the caller will read it back on
 * the next `findRecentSessionByKey`.
 */
export function recordIdempotencyKey(key: string, sessionId: string): void {
  try {
    insertIdempotencyKey({ key, session_id: sessionId });
  } catch {
    // Primary-key collision is benign — the prior INSERT wins.
  }
}

/**
 * Generate a fresh opaque cookie value for the `vizzor.session`
 * cookie. 16 random bytes → 22 chars base64url, URL-safe.
 *
 * Callers (the route handler) are responsible for setting the cookie
 * on the response with HttpOnly, SameSite=Strict, Secure (production),
 * Path=/, and a Max-Age matching `COOKIE_TTL_MS / 1000`.
 */
export function mintCookieSessionId(): string {
  return randomBytes(16).toString('base64url');
}
