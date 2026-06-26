/**
 * Engine webhook — outbound POST from site → engine on subscription
 * confirmation.
 *
 * The function under test is `notifyEngineSubscriptionUpdated` in
 * `lib/payment/session.ts`. It is module-internal, so we exercise it
 * through its only call site, `finalizeSession`, which fires the
 * webhook asynchronously after committing the SQLite transaction.
 *
 * Coverage shipped now (Stream C):
 *  - Skips POST when `VIZZOR_API_URL` or `VIZZOR_BOT_TOKEN` is missing
 *  - POSTs to `/v1/internal/subscription-updated`
 *  - Sends the `X-Vizzor-Bot-Token` shared-secret header
 *  - On 2xx, returns without throwing / does not retry
 *
 * Stream A will add:
 *  - 3-attempt exponential backoff on 5xx (1s, 3s, 9s)
 *  - `Retry-After` honour on 429
 *  - `Idempotency-Key: ${sessionId}` header for engine-side dedup
 *
 * Those assertions are `it.todo` until the impl lands.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { finalizeSession } from '@/lib/payment/session';
import {
  getSessionRow,
  insertSession,
  type SessionRow,
} from '@/lib/payment/db';

const PAYER = 'PayerWalletForNotifyEngineTest11111111111111';

function insertPendingSession(sessionId: string): SessionRow {
  insertSession({
    session_id: sessionId,
    tier: 'pro',
    cadence: 'monthly',
    chain: 'solana',
    token: 'native',
    dest_address: '11111111111111111111111111111111',
    amount: 1,
    decimals: 9,
    amount_usd_cents: 999,
    discount_bps: 0,
    rate_locked: 150,
    expires_at: Date.now() + 5 * 60 * 1000,
    status: 'pending',
    memo: sessionId,
  });
  const row = getSessionRow(sessionId);
  if (!row) throw new Error('test fixture missing');
  return row;
}

let prevApiUrl: string | undefined;
let prevToken: string | undefined;
let prevPubApiUrl: string | undefined;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  prevApiUrl = process.env.VIZZOR_API_URL;
  prevToken = process.env.VIZZOR_BOT_TOKEN;
  prevPubApiUrl = process.env.NEXT_PUBLIC_VIZZOR_API_URL;

  fetchSpy = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  if (prevApiUrl === undefined) delete process.env.VIZZOR_API_URL;
  else process.env.VIZZOR_API_URL = prevApiUrl;
  if (prevToken === undefined) delete process.env.VIZZOR_BOT_TOKEN;
  else process.env.VIZZOR_BOT_TOKEN = prevToken;
  if (prevPubApiUrl === undefined) delete process.env.NEXT_PUBLIC_VIZZOR_API_URL;
  else process.env.NEXT_PUBLIC_VIZZOR_API_URL = prevPubApiUrl;
  vi.restoreAllMocks();
});

// Wait for the next microtask queue + an event-loop turn so the
// fire-and-forget webhook has a chance to settle before assertions.
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

describe('notifyEngineSubscriptionUpdated (via finalizeSession)', () => {
  describe('skip behaviour', () => {
    it('does NOT POST when VIZZOR_API_URL is unset', async () => {
      delete process.env.VIZZOR_API_URL;
      delete process.env.NEXT_PUBLIC_VIZZOR_API_URL;
      process.env.VIZZOR_BOT_TOKEN = 'tok-aaaaaaaaaaaaaaaa';

      const row = insertPendingSession('ses_skip_noapi');
      const result = finalizeSession(row, 'sig_skip_noapi', PAYER);
      expect(result.confirmed).toBe(true);

      await flush();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('does NOT POST when VIZZOR_BOT_TOKEN is unset', async () => {
      process.env.VIZZOR_API_URL = 'https://api.example.test';
      delete process.env.VIZZOR_BOT_TOKEN;

      const row = insertPendingSession('ses_skip_notoken');
      const result = finalizeSession(row, 'sig_skip_notoken', PAYER);
      expect(result.confirmed).toBe(true);

      await flush();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    beforeEach(() => {
      process.env.VIZZOR_API_URL = 'https://api.example.test';
      process.env.VIZZOR_BOT_TOKEN = 'tok-bbbbbbbbbbbbbbbb';
    });

    it('POSTs to /v1/internal/subscription-updated with the shared-secret header', async () => {
      const row = insertPendingSession('ses_happy_post');
      finalizeSession(row, 'sig_happy_post', PAYER);
      await flush();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe(
        'https://api.example.test/v1/internal/subscription-updated',
      );
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Vizzor-Bot-Token']).toBe('tok-bbbbbbbbbbbbbbbb');
      expect(headers['content-type']).toBe('application/json');

      const payload = JSON.parse(init.body as string);
      expect(payload).toMatchObject({ wallet: PAYER, tier: 'pro' });
    });

    it('strips a trailing slash from VIZZOR_API_URL', async () => {
      process.env.VIZZOR_API_URL = 'https://api.example.test/';
      const row = insertPendingSession('ses_strip_slash');
      finalizeSession(row, 'sig_strip', PAYER);
      await flush();

      const [calledUrl] = fetchSpy.mock.calls[0] as [string];
      expect(calledUrl).toBe(
        'https://api.example.test/v1/internal/subscription-updated',
      );
    });

    it('returns without retry on 2xx', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('{"ok":true}', { status: 200 }),
      );
      const row = insertPendingSession('ses_no_retry_2xx');
      finalizeSession(row, 'sig_2xx', PAYER);
      await flush();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('swallows transport errors without throwing (engine cache is eventual)', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const row = insertPendingSession('ses_swallow');
      // The webhook is fire-and-forget; finalizeSession must not bubble.
      expect(() => finalizeSession(row, 'sig_swallow', PAYER)).not.toThrow();
      await flush();
    });
  });

  describe('Stream A pending', () => {
    // The retry + idempotency-key contract is documented in the
    // mainnet sprint plan (P1 / API Backend hardening). These tests
    // are queued and pass `it.todo` until Stream A's session.ts
    // change lands so the suite never red-bars during the sprint.
    it.todo(
      'retries up to 3 times with exponential backoff (1s, 3s, 9s) on 5xx',
    );
    it.todo('honours Retry-After header on 429');
    it.todo(
      'sends Idempotency-Key: <sessionId> so the engine LRU can dedupe',
    );
    it.todo('logs metric + gives up after the third 5xx');
  });
});
