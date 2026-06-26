import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { listAlertsForWallet, walletToEngineUserId } from '@/lib/alerts';

const WALLET_A = 'AAAA1111aaaa1111AAAA1111aaaa1111AAAA1111aaaa';

describe('listAlertsForWallet', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.useRealTimers();
  });

  it('returns the empty bundle when the wallet is empty', async () => {
    const result = await listAlertsForWallet('');
    expect(result.live).toBe(false);
    expect(result.bundle.armed).toEqual([]);
    expect(result.bundle.triggered).toEqual([]);
    expect(result.bundle.resolved).toEqual([]);
    expect(result.bundle.cancelled).toEqual([]);
  });

  it('serves the empty fallback when the upstream returns non-OK', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('upstream down', { status: 503 }),
    );
    const result = await listAlertsForWallet(WALLET_A);
    expect(result.live).toBe(false);
    expect(result.bundle.armed).toEqual([]);
  });

  it('serves the empty fallback when the upstream returns a non-array payload', async () => {
    // Engine should return AlertRule[] directly; an object payload is
    // malformed and the helper must not crash.
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ not_alerts: 'oops' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await listAlertsForWallet(WALLET_A);
    // live=true because the request succeeded, but the bundle is empty
    // because nothing in the payload mapped to AlertRow.
    expect(result.live).toBe(true);
    expect(result.bundle.armed).toEqual([]);
  });

  it('translates engine AlertRule[] into AlertRow buckets', async () => {
    // Engine schema: priceAbove/priceBelow + label, not price+direction.
    const now = Date.now();
    const payload = [
      {
        id: 'a1',
        type: 'price_threshold',
        enabled: true,
        symbols: ['BTC'],
        priceAbove: 70000,
        label: 'TP1',
        createdAt: now,
        userId: walletToEngineUserId(WALLET_A),
      },
      {
        id: 'a2',
        type: 'price_threshold',
        enabled: false,
        symbols: ['ETH'],
        priceBelow: 2100,
        label: 'SL',
        createdAt: now,
        userId: walletToEngineUserId(WALLET_A),
      },
    ];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await listAlertsForWallet(WALLET_A);
    expect(result.live).toBe(true);
    expect(result.bundle.armed.map((a) => a.id)).toEqual(['a1']);
    expect(result.bundle.armed[0]?.direction).toBe('up');
    expect(result.bundle.armed[0]?.price).toBe(70000);
    expect(result.bundle.armed[0]?.kind).toBe('tp1');
    // disabled engine rule → cancelled site row
    expect(result.bundle.cancelled.map((a) => a.id)).toEqual(['a2']);
    expect(result.bundle.cancelled[0]?.direction).toBe('down');
  });

  it('drops engine rules whose type is not price_threshold', async () => {
    const payload = [
      {
        id: 'pump-rule',
        type: 'pump_detected',
        enabled: true,
        symbols: ['SOL'],
        createdAt: Date.now(),
      },
      {
        id: 'ok-price',
        type: 'price_threshold',
        enabled: true,
        symbols: ['ETH'],
        priceAbove: 2100,
        label: 'ENTRY',
        createdAt: Date.now(),
      },
    ];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await listAlertsForWallet(WALLET_A);
    const allIds = [
      ...result.bundle.armed,
      ...result.bundle.triggered,
      ...result.bundle.resolved,
      ...result.bundle.cancelled,
    ].map((r) => r.id);
    expect(allIds).toEqual(['ok-price']);
  });

  it('passes the wallet-derived userId (not the raw wallet) to the engine', async () => {
    const spy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    globalThis.fetch = spy;
    await listAlertsForWallet(WALLET_A);
    const [calledUrl] = spy.mock.calls[0] as [string];
    const expectedUserId = walletToEngineUserId(WALLET_A);
    // userId is sent in the query — raw wallet must NEVER appear (avoids
    // leaking the SIWS-bound address to engine logs or 3rd-party probes).
    expect(calledUrl).toContain(
      `userId=${encodeURIComponent(expectedUserId)}`,
    );
    expect(calledUrl).not.toContain(WALLET_A);
  });

  it('serves the empty fallback on fetch network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await listAlertsForWallet(WALLET_A);
    expect(result.live).toBe(false);
    expect(result.bundle.armed).toEqual([]);
  });
});
