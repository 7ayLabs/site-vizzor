// ---------------------------------------------------------------------------
// vizzor-auth — HMAC-signed token verifier shared with the engine.
//
// These tests pin the on-the-wire token shape so a future change here
// cannot drift the site verifier away from the engine verifier. The
// engine has the matching test under
// `vizzor/test/unit/api/auth/wallet-auth.test.ts`.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import {
  verifyVizzorAuthToken,
  type VizzorAuthPayload,
} from '@/lib/payment/vizzor-auth';

// Generated at module-load time so no hard-coded high-entropy string ever
// lands in the diff. Each test run uses a fresh value; the tests don't
// care what it is as long as the same secret is used to sign + verify.
const SECRET = randomBytes(32).toString('hex');

function mintToken(
  payload: Partial<VizzorAuthPayload> = {},
  secret: string = SECRET,
): string {
  const now = Math.floor(Date.now() / 1000);
  const full: VizzorAuthPayload = {
    wallet: payload.wallet ?? 'So11111111111111111111111111111111111111112',
    tier: payload.tier ?? 'pro',
    iat: payload.iat ?? now,
    exp: payload.exp ?? now + 3600,
    v: payload.v ?? 1,
  };
  const payloadB64 = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

describe('lib/payment/vizzor-auth — verifyVizzorAuthToken', () => {
  it('accepts a freshly-minted Pro token', () => {
    const token = mintToken();
    const result = verifyVizzorAuthToken(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.info.tier).toBe('pro');
      expect(result.info.walletAddress).toBe(
        'So11111111111111111111111111111111111111112',
      );
    }
  });

  it('tolerates the vizzor_auth_v1 prefix when supplied', () => {
    const token = mintToken();
    const result = verifyVizzorAuthToken(`vizzor_auth_v1.${token}`, SECRET);
    expect(result.ok).toBe(true);
  });

  it('rejects with no_secret_configured when secret is missing', () => {
    const token = mintToken();
    const result = verifyVizzorAuthToken(token, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_secret_configured');
  });

  it('rejects with bad_signature when the secret differs', () => {
    // Mint with a secret that is provably different from SECRET — using
    // randomBytes again guarantees no collision while keeping the diff
    // free of any literal that could trip secret scanners.
    const token = mintToken({}, randomBytes(32).toString('hex'));
    const result = verifyVizzorAuthToken(token, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_signature');
  });

  it('rejects with expired when the exp has passed', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = mintToken({ iat: now - 7200, exp: now - 3600 });
    const result = verifyVizzorAuthToken(token, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('rejects with invalid_payload when tier is not in the union', () => {
    // Hand-mint a token whose tier is not 'free'/'trial'/'pro'/'elite'/'lifetime'.
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      wallet: 'WALLET',
      tier: 'platinum',
      iat: now,
      exp: now + 3600,
      v: 1,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
    const result = verifyVizzorAuthToken(`${payloadB64}.${sig}`, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_payload');
  });

  it('rejects unsupported_version', () => {
    const token = mintToken({ v: 99 });
    const result = verifyVizzorAuthToken(token, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported_version');
  });

  it('rejects malformed tokens (no dot, garbage)', () => {
    const result1 = verifyVizzorAuthToken('not-a-token', SECRET);
    expect(result1.ok).toBe(false);
    if (!result1.ok) expect(result1.reason).toBe('malformed');

    const result2 = verifyVizzorAuthToken('.', SECRET);
    expect(result2.ok).toBe(false);
    if (!result2.ok) expect(result2.reason).toBe('malformed');
  });
});
