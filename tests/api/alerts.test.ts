/**
 * GET /api/alerts — wallet-scoped alerts list.
 *
 * Asserts the security contract:
 *   - Unauthenticated requests get 401 with `reason: 'unauthenticated'`.
 *   - The wallet is sourced from the active SIWS session, never from
 *     a query parameter (a hostile `?wallet=…` is ignored).
 *   - Engine-offline response carries `_stale: true` so the UI can
 *     surface the snapshot state.
 *
 * Implementation note: `getActiveSession()` calls `cookies()` from
 * `next/headers` which requires a request scope unavailable in
 * vitest's node environment. We mock the auth-session module so the
 * route's auth gate becomes deterministic — no actual cookie parsing
 * is exercised here (that's covered by `tests/payment/siws.test.ts`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `vi.mock` calls are hoisted to the top of the file, so any variables
// they reference must also be hoisted via `vi.hoisted`. The mock fn
// is then available inside the factory at evaluation time AND in the
// test body so individual tests can program its behaviour.
const { mockGetActiveSession } = vi.hoisted(() => ({
  mockGetActiveSession: vi.fn(),
}));

vi.mock('@/lib/payment/auth-session', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/payment/auth-session')
  >('@/lib/payment/auth-session');
  return {
    ...actual,
    getActiveSession: mockGetActiveSession,
  };
});

// Also stub the subscription lookup so the route doesn't hit the DB
// in this test — keeps the test surface narrow.
vi.mock('@/lib/payment/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payment/db')>(
    '@/lib/payment/db',
  );
  return {
    ...actual,
    findActiveSubscriptionByWallet: vi.fn(() => null),
  };
});

import { GET, POST } from '@/app/api/alerts/route';
import { DELETE } from '@/app/api/alerts/[id]/route';

const WALLET_A = 'AAAA1111aaaa1111AAAA1111aaaa1111AAAA1111aaaa';

function buildRequest(url = 'http://localhost:3000/api/alerts') {
  return new Request(url, {
    method: 'GET',
    headers: { origin: 'http://localhost:3000' },
  });
}

describe('GET /api/alerts', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockGetActiveSession.mockReset();
    // Default upstream — offline so the route serves the snapshot
    // fallback. Individual tests override.
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns 401 for unauthenticated callers', async () => {
    mockGetActiveSession.mockResolvedValue(null);
    const res = await GET(buildRequest());
    expect(res.status).toBe(401);
    const json = (await res.json()) as { ok: boolean; reason: string };
    expect(json.ok).toBe(false);
    expect(json.reason).toBe('unauthenticated');
  });

  it('returns 200 with an alerts bundle for a signed-in wallet', async () => {
    mockGetActiveSession.mockResolvedValue({
      wallet: WALLET_A,
      expiresAt: Date.now() + 60_000,
    });
    const res = await GET(buildRequest());
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      alerts: { armed: unknown[]; triggered: unknown[]; resolved: unknown[] };
      _stale?: boolean;
    };
    expect(json.ok).toBe(true);
    expect(json.alerts).toBeDefined();
    expect(Array.isArray(json.alerts.armed)).toBe(true);
  });

  it('flags _stale: true when the upstream engine is unreachable', async () => {
    mockGetActiveSession.mockResolvedValue({
      wallet: WALLET_A,
      expiresAt: Date.now() + 60_000,
    });
    const res = await GET(buildRequest());
    const json = (await res.json()) as { _stale?: boolean };
    expect(json._stale).toBe(true);
  });

  it('POST returns 401 for unauthenticated callers', async () => {
    mockGetActiveSession.mockResolvedValue(null);
    const req = new Request('http://localhost:3000/api/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        symbol: 'BTC',
        kind: 'custom',
        direction: 'up',
        price: 100000,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('POST returns 400 on invalid body shape', async () => {
    mockGetActiveSession.mockResolvedValue({
      wallet: WALLET_A,
      expiresAt: Date.now() + 60_000,
    });
    const req = new Request('http://localhost:3000/api/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ symbol: 'BTC' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('POST returns 503 when the engine is unreachable', async () => {
    mockGetActiveSession.mockResolvedValue({
      wallet: WALLET_A,
      expiresAt: Date.now() + 60_000,
    });
    const req = new Request('http://localhost:3000/api/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        symbol: 'BTC',
        kind: 'custom',
        direction: 'up',
        price: 100000,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const json = (await res.json()) as { ok: boolean; reason: string };
    expect(json.reason).toBe('engine_unavailable');
  });

  it('POST sends the SESSION wallet (as engine userId) to the engine, never a body-supplied one', async () => {
    mockGetActiveSession.mockResolvedValue({
      wallet: WALLET_A,
      expiresAt: Date.now() + 60_000,
    });
    // Engine returns the created AlertRule directly (not wrapped).
    const spy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'a-1',
          type: 'price_threshold',
          enabled: true,
          symbols: ['BTC'],
          priceAbove: 100000,
          label: 'CUSTOM',
          createdAt: Date.now(),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    globalThis.fetch = spy;
    const req = new Request('http://localhost:3000/api/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        wallet: 'HOSTILE_WALLET',
        userId: 'HOSTILE_USER_ID',
        symbol: 'BTC',
        kind: 'custom',
        direction: 'up',
        price: 100000,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(spy).toHaveBeenCalled();
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as { userId: string };
    // Engine-bound userId must derive from the SESSION wallet, never
    // from a body-supplied wallet or userId. Hostile values are ignored.
    expect(sent.userId).toMatch(/^web:/);
    expect(sent.userId).not.toBe('HOSTILE_USER_ID');
    expect(sent.userId).not.toContain('HOSTILE_WALLET');
  });

  it('DELETE returns 401 for unauthenticated callers', async () => {
    mockGetActiveSession.mockResolvedValue(null);
    const req = new Request('http://localhost:3000/api/alerts/a-1', {
      method: 'DELETE',
      headers: { origin: 'http://localhost:3000' },
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'a-1' }) });
    expect(res.status).toBe(401);
  });

  it('DELETE returns 503 when engine is unreachable', async () => {
    mockGetActiveSession.mockResolvedValue({
      wallet: WALLET_A,
      expiresAt: Date.now() + 60_000,
    });
    const req = new Request('http://localhost:3000/api/alerts/a-1', {
      method: 'DELETE',
      headers: { origin: 'http://localhost:3000' },
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'a-1' }) });
    expect(res.status).toBe(503);
  });

  it('DELETE sends the SESSION-derived userId on the engine URL', async () => {
    mockGetActiveSession.mockResolvedValue({
      wallet: WALLET_A,
      expiresAt: Date.now() + 60_000,
    });
    const spy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    globalThis.fetch = spy;
    const req = new Request('http://localhost:3000/api/alerts/a-1', {
      method: 'DELETE',
      headers: { origin: 'http://localhost:3000' },
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'a-1' }) });
    expect(res.status).toBe(200);
    const [calledUrl] = spy.mock.calls[0] as [string, RequestInit];
    // userId is derived server-side from the SESSION wallet.
    expect(calledUrl).toMatch(/userId=web%3A/);
    expect(calledUrl).toContain('/v1/alerts/a-1');
    // Raw wallet must NEVER leak to the engine URL.
    expect(calledUrl).not.toContain(WALLET_A);
  });

  it('ignores a client-supplied wallet query parameter — userId comes from the session only', async () => {
    mockGetActiveSession.mockResolvedValue({
      wallet: WALLET_A,
      expiresAt: Date.now() + 60_000,
    });
    const spy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    globalThis.fetch = spy;
    // Craft a request with a HOSTILE wallet parameter. Route should
    // ignore it and call the upstream with the SESSION-derived userId.
    const req = new Request(
      'http://localhost:3000/api/alerts?wallet=HOSTILE_WALLET',
      {
        method: 'GET',
        headers: { origin: 'http://localhost:3000' },
      },
    );
    await GET(req);
    expect(spy).toHaveBeenCalled();
    const [calledUrl] = (spy.mock.calls[0] as [string]);
    // Upstream URL MUST carry the session-derived userId, not the
    // hostile query parameter the attacker tried to inject.
    expect(calledUrl).toMatch(/userId=web%3A/);
    expect(calledUrl).not.toContain('HOSTILE_WALLET');
    expect(calledUrl).not.toContain(WALLET_A);
  });
});
