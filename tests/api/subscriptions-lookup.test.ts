/**
 * GET /api/subscriptions/lookup — real tests.
 *
 * NOTE on Stream-C brief contract clarification: the brief mentions a
 * `?wallet=` query param, but the actual route (`app/api/subscriptions/
 * lookup/route.ts`) takes `?telegram_user_id=`. The wallet-keyed lookup
 * is `findActiveSubscriptionByWallet`, used elsewhere. We test the
 * actual contract — `telegram_user_id` — because that is what the
 * engine's `health-payments` probe and the bot fan-out hit. The
 * "null-as-success" behaviour is identical either way.
 *
 * Covers:
 *  - 400 when telegram_user_id is missing or invalid
 *  - 200 + { subscription: null } when no active sub exists (the
 *    engine cache relies on null-as-success to short-circuit free-tier
 *    quota lookups; never reshape this into a 404)
 *  - 200 + populated subscription when one exists (fixture row via
 *    `insertSubscription`)
 *  - Cache-Control: no-store on every response (architect's locked
 *    decision — see route header comment)
 *  - Auth gate: 401 without the shared-secret header in production
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/subscriptions/lookup/route';
import { insertSubscription } from '@/lib/payment/db';

const BOT_SECRET = 'bot-test-secret-' + 'x'.repeat(16);

function makeRequest(
  search: string,
  opts: { withAuth?: boolean } = { withAuth: true },
): Request {
  const url = `http://localhost:3000/api/subscriptions/lookup${search}`;
  const headers: Record<string, string> = {};
  if (opts.withAuth !== false) {
    headers['x-vizzor-bot-token'] = BOT_SECRET;
  }
  return new Request(url, { method: 'GET', headers });
}

let prevSecret: string | undefined;
let prevNodeEnv: string | undefined;

beforeEach(() => {
  prevSecret = process.env.VIZZOR_BOT_SHARED_SECRET;
  prevNodeEnv = process.env.NODE_ENV;
  process.env.VIZZOR_BOT_SHARED_SECRET = BOT_SECRET;
  // Force prod posture so unset secrets do not allow-soft through.
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
});

afterEach(() => {
  if (prevSecret === undefined) delete process.env.VIZZOR_BOT_SHARED_SECRET;
  else process.env.VIZZOR_BOT_SHARED_SECRET = prevSecret;
  (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
});

describe('GET /api/subscriptions/lookup', () => {
  describe('auth', () => {
    it('returns 401 when x-vizzor-bot-token is missing', async () => {
      const res = await GET(makeRequest('?telegram_user_id=12345', { withAuth: false }));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ ok: false, reason: 'unauthorized' });
    });
  });

  describe('query validation', () => {
    it('returns 400 invalid_input when telegram_user_id is absent', async () => {
      const res = await GET(makeRequest(''));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({ ok: false, reason: 'invalid_input' });
    });

    it('returns 400 invalid_input when telegram_user_id is empty', async () => {
      const res = await GET(makeRequest('?telegram_user_id='));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({ ok: false, reason: 'invalid_input' });
    });

    it('returns 400 invalid_input when telegram_user_id is not numeric', async () => {
      const res = await GET(makeRequest('?telegram_user_id=not-a-number'));
      expect(res.status).toBe(400);
    });

    it('returns 400 invalid_input when telegram_user_id is zero or negative', async () => {
      const zero = await GET(makeRequest('?telegram_user_id=0'));
      expect(zero.status).toBe(400);
      const neg = await GET(makeRequest('?telegram_user_id=-99'));
      expect(neg.status).toBe(400);
    });
  });

  describe('happy path', () => {
    it('returns 200 + subscription:null when wallet has no active subscription (null-as-success)', async () => {
      const res = await GET(makeRequest('?telegram_user_id=99999'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, subscription: null });
    });

    it('returns 200 + populated subscription object when one exists', async () => {
      const tgId = 424242;
      const wallet = 'WalletAddrForLookupTest11111111111111111111';
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      insertSubscription({
        wallet_address: wallet,
        tier: 'pro',
        cadence: 'monthly',
        expires_at: expiresAt,
        session_id: null,
        telegram_user_id: tgId,
      });

      const res = await GET(makeRequest(`?telegram_user_id=${tgId}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.subscription).toMatchObject({
        tier: 'pro',
        cadence: 'monthly',
        wallet_address: wallet,
      });
      expect(body.subscription.expires_at).toBe(expiresAt);
    });

    it('filters out subscriptions whose expires_at is in the past', async () => {
      const tgId = 88888;
      insertSubscription({
        wallet_address: 'ExpiredWalletAddr11111111111111111111111111',
        tier: 'pro',
        cadence: 'monthly',
        expires_at: Date.now() - 60_000,
        session_id: null,
        telegram_user_id: tgId,
      });

      const res = await GET(makeRequest(`?telegram_user_id=${tgId}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.subscription).toBeNull();
    });

    it('returns lifetime subscriptions where expires_at is NULL', async () => {
      const tgId = 77777;
      insertSubscription({
        wallet_address: 'LifetimeWalletAddr1111111111111111111111111',
        tier: 'elite',
        cadence: 'lifetime',
        expires_at: null,
        session_id: null,
        telegram_user_id: tgId,
      });

      const res = await GET(makeRequest(`?telegram_user_id=${tgId}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.subscription).toMatchObject({
        tier: 'elite',
        cadence: 'lifetime',
        expires_at: null,
      });
    });
  });

  describe('cache headers', () => {
    it('sets Cache-Control: no-store on the success response', async () => {
      const res = await GET(makeRequest('?telegram_user_id=12345'));
      expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('sets Cache-Control: no-store on the 400 response', async () => {
      const res = await GET(makeRequest(''));
      expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('sets Cache-Control: no-store on the 401 response', async () => {
      const res = await GET(
        makeRequest('?telegram_user_id=12345', { withAuth: false }),
      );
      expect(res.headers.get('cache-control')).toBe('no-store');
    });
  });
});
