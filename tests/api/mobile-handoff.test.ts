/**
 * /api/auth/mobile-handoff — server-side handoff persistence for the
 * mobile Connect-Protocol flow.
 *
 * Asserts:
 *   - POST stores a row and returns a 64-char hex `hid`
 *   - POST /redeem returns the same state on first call
 *   - second /redeem on the same hid returns 404 (one-shot semantics)
 *   - expired rows return 404 + are purged from the table
 *   - oversized state is refused
 *   - same-origin guard rejects cross-origin POSTs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { POST as createPOST } from '@/app/api/auth/mobile-handoff/route';
import { POST as redeemPOST } from '@/app/api/auth/mobile-handoff/redeem/route';
import {
  insertMobileHandoff,
  redeemMobileHandoff,
  pruneExpiredMobileHandoffs,
} from '@/lib/payment/db';

const VALID_ORIGIN = 'http://localhost:3000';

beforeEach(() => {
  // Allow same-origin checks in tests — origin-check middleware reads
  // this env var.
  process.env.NEXT_PUBLIC_ALLOWED_ORIGINS = VALID_ORIGIN;
});

function buildCreateRequest(state: unknown, origin = VALID_ORIGIN) {
  return new Request('http://localhost:3000/api/auth/mobile-handoff', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ state }),
  });
}

function buildRedeemRequest(hid: unknown, origin = VALID_ORIGIN) {
  return new Request('http://localhost:3000/api/auth/mobile-handoff/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ hid }),
  });
}

const SAMPLE_STATE = {
  providerId: 'phantom',
  dappPublicKey: 'pub',
  dappSecretKey: 'sec',
  returnTo: 'https://test.vizzor.ai/predict',
};

describe('POST /api/auth/mobile-handoff (create)', () => {
  it('stores the state and returns a 64-char hex hid', async () => {
    const res = await createPOST(buildCreateRequest(SAMPLE_STATE));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; hid: string };
    expect(body.ok).toBe(true);
    expect(body.hid).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a missing or non-object state with 400', async () => {
    const noState = await createPOST(
      new Request('http://localhost:3000/api/auth/mobile-handoff', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: VALID_ORIGIN },
        body: JSON.stringify({}),
      }),
    );
    expect(noState.status).toBe(400);
    const stringState = await createPOST(
      buildCreateRequest('just-a-string' as unknown),
    );
    expect(stringState.status).toBe(400);
  });

  it('refuses oversized state with 413', async () => {
    const huge = { blob: 'x'.repeat(10 * 1024) };
    const res = await createPOST(buildCreateRequest(huge));
    expect(res.status).toBe(413);
  });

  it('rejects cross-origin POSTs with 403', async () => {
    const res = await createPOST(
      buildCreateRequest(SAMPLE_STATE, 'https://evil.example.com'),
    );
    expect(res.status).toBe(403);
  });
});

describe('POST /api/auth/mobile-handoff/redeem', () => {
  it('returns the stored state on first call and deletes the row', async () => {
    const created = await createPOST(buildCreateRequest(SAMPLE_STATE));
    const { hid } = (await created.json()) as { hid: string };

    const first = await redeemPOST(buildRedeemRequest(hid));
    expect(first.status).toBe(200);
    const body = (await first.json()) as {
      ok: boolean;
      state: typeof SAMPLE_STATE;
    };
    expect(body.ok).toBe(true);
    expect(body.state).toEqual(SAMPLE_STATE);

    // Second redeem MUST be a 404 — the row is gone.
    const second = await redeemPOST(buildRedeemRequest(hid));
    expect(second.status).toBe(404);
  });

  it('rejects a malformed hid with 400', async () => {
    const badHex = await redeemPOST(buildRedeemRequest('not-a-hid'));
    expect(badHex.status).toBe(400);
    const wrongLen = await redeemPOST(buildRedeemRequest('abc123'));
    expect(wrongLen.status).toBe(400);
  });

  it('returns 404 for an unknown hid', async () => {
    const unknown = 'a'.repeat(64);
    const res = await redeemPOST(buildRedeemRequest(unknown));
    expect(res.status).toBe(404);
  });

  it('refuses an expired row + the row is purged', async () => {
    const hid = 'b'.repeat(64);
    // Insert directly with an already-passed expires_at so we don't
    // have to wait wall-clock.
    insertMobileHandoff({
      id: hid,
      state: JSON.stringify(SAMPLE_STATE),
      expiresAt: Date.now() - 1_000,
    });
    const res = await redeemPOST(buildRedeemRequest(hid));
    expect(res.status).toBe(404);
    // The redeem helper itself returns null for expired AND deletes —
    // subsequent direct read should be null.
    expect(redeemMobileHandoff(hid)).toBeNull();
  });
});

describe('pruneExpiredMobileHandoffs', () => {
  it('removes only the rows whose TTL has already passed', () => {
    insertMobileHandoff({
      id: 'c'.repeat(64),
      state: '{}',
      expiresAt: Date.now() - 5_000,
    });
    insertMobileHandoff({
      id: 'd'.repeat(64),
      state: '{}',
      expiresAt: Date.now() + 60_000,
    });
    const removed = pruneExpiredMobileHandoffs();
    expect(removed).toBe(1);
    // Fresh row survives.
    expect(redeemMobileHandoff('d'.repeat(64))).not.toBeNull();
  });
});
