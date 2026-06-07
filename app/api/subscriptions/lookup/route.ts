/**
 * GET /api/subscriptions/lookup?telegram_user_id={id} — bot-side
 * subscription lookup (v0.2.0).
 *
 * The bot polls this route on every `/predict` invocation to decide
 * whether to forward the request to the engine or fall back to the
 * free-tier quota. The site is the source of truth for subscription
 * state in v0.2.0 (RFC §4, Option a); a v0.3.0 migration will move both
 * site and engine onto a shared Postgres table and retire this hop.
 *
 * Contract: `docs/rfc/v0.2.0/wallet-telegram-binding.md` §4.
 *
 * Auth: `x-vizzor-bot-token` shared secret via `requireBotSecret`.
 *
 * Caching: no server-side cache by default. The architect's locked
 * decision is that a stale cache would hide a freshly-redeemed grant
 * from the bot for the duration of the TTL — and that is exactly the
 * acceptance bar we cannot break (user pays on Saturday night, expects
 * `/predict` to work on the next bot message). The
 * `VIZZOR_BIND_LOOKUP_CACHE_TTL_MS` env var exists as an operator
 * escape hatch during incident response; a positive value engages a
 * small in-process LRU keyed by `telegram_user_id`. Default is `0`
 * (off). The cache is local to the Node process; horizontal scaling
 * weakens its hit ratio but never introduces cross-host inconsistency.
 *
 * "No subscription found" is a successful response, not an error: the
 * route returns `200 { ok: true, subscription: null }`. The bot
 * interprets `null` as "treat this TG user as free-tier".
 */

import { NextResponse } from 'next/server';
import {
  findSubscriptionByTelegramId,
  type SubscriptionRow,
} from '@/lib/payment/db';
import { requireBotSecret } from '@/lib/payment/bot-auth';
import { enforceRateLimit } from '@/lib/payment/rate-limit';
import { recordAudit } from '@/lib/payment/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type WireSubscription = {
  tier: string;
  cadence: string;
  expires_at: number | null;
  wallet_address: string;
};

function toWireSubscription(row: SubscriptionRow): WireSubscription {
  return {
    tier: row.tier,
    cadence: row.cadence,
    expires_at: row.expires_at,
    wallet_address: row.wallet_address,
  };
}

function jsonNoStore(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/* ------------------------------------------------------------------ *\
 * Optional in-process LRU cache. Disabled by default. Lifetime is the
 * Node process; restart clears it. Keyed by `telegram_user_id`. Cache
 * stores both hit and miss (null) entries so a "no sub" answer is
 * also short-circuited during the TTL window.
\* ------------------------------------------------------------------ */

interface CacheEntry {
  value: WireSubscription | null;
  expiresAt: number;
}

const CACHE_MAX_ENTRIES = 1024;
const cache = new Map<number, CacheEntry>();

function readCacheTtlMs(): number {
  const raw = process.env.VIZZOR_BIND_LOOKUP_CACHE_TTL_MS;
  if (raw === undefined || raw.length === 0) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function cacheGet(
  telegramUserId: number,
  now: number,
): CacheEntry | undefined {
  const hit = cache.get(telegramUserId);
  if (!hit) return undefined;
  if (hit.expiresAt <= now) {
    cache.delete(telegramUserId);
    return undefined;
  }
  // Refresh recency by re-inserting (Map preserves insertion order).
  cache.delete(telegramUserId);
  cache.set(telegramUserId, hit);
  return hit;
}

function cacheSet(
  telegramUserId: number,
  value: WireSubscription | null,
  ttlMs: number,
  now: number,
): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Evict oldest by insertion order.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(telegramUserId, { value, expiresAt: now + ttlMs });
}

export async function GET(req: Request): Promise<NextResponse> {
  const limited = enforceRateLimit(req, 'subscriptions.lookup');
  if (limited) return limited as unknown as NextResponse;

  const auth = requireBotSecret(req);
  if (!auth.ok) {
    recordAudit({
      eventType: 'subscription.lookup',
      actor: 'bot',
      outcome: 'denied',
      req,
    });
    return jsonNoStore({ ok: false, reason: 'unauthorized' }, 401);
  }

  const url = new URL(req.url);
  const rawId = url.searchParams.get('telegram_user_id');
  if (rawId === null || rawId.length === 0) {
    return jsonNoStore({ ok: false, reason: 'invalid_input' }, 400);
  }
  const telegramUserId = Number(rawId);
  if (
    !Number.isFinite(telegramUserId) ||
    !Number.isInteger(telegramUserId) ||
    telegramUserId <= 0
  ) {
    return jsonNoStore({ ok: false, reason: 'invalid_input' }, 400);
  }

  const ttlMs = readCacheTtlMs();
  const now = Date.now();

  if (ttlMs > 0) {
    const hit = cacheGet(telegramUserId, now);
    if (hit !== undefined) {
      recordAudit({
        eventType: 'subscription.lookup',
        actor: 'bot',
        subject: telegramUserId,
        outcome: hit.value ? 'found' : 'not_found',
        req,
      });
      return jsonNoStore({ ok: true, subscription: hit.value }, 200);
    }
  }

  const row = findSubscriptionByTelegramId(telegramUserId, now);
  const wire = row ? toWireSubscription(row) : null;

  if (ttlMs > 0) {
    cacheSet(telegramUserId, wire, ttlMs, now);
  }

  recordAudit({
    eventType: 'subscription.lookup',
    actor: 'bot',
    subject: telegramUserId,
    outcome: wire ? 'found' : 'not_found',
    req,
  });

  return jsonNoStore({ ok: true, subscription: wire }, 200);
}
