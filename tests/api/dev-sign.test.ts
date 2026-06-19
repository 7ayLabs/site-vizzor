/**
 * POST /api/auth/dev-sign — dev-only auth bypass.
 *
 * The route is double-gated:
 *   1. `NEXT_PUBLIC_ALLOW_DEV_AUTH === 'true'`
 *   2. Request origin is localhost OR matches the
 *      `DEV_AUTH_ALLOWED_ORIGINS` comma-separated allow-list
 *
 * These tests assert the gate fails closed in production and opens
 * cleanly for both localhost dev and the explicit allow-list path used
 * by the test.vizzor.ai staging deploy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from '@/app/api/auth/dev-sign/route';

type EnvMutable = Record<string, string | undefined>;

const VALID_WALLET = '5oQ2uHV8TFQ1w1cXSotFHdvFiKXQyesuMY2YTLhtb1qL';

function buildRequest(body: unknown, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/auth/dev-sign', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/dev-sign', () => {
  let originalFlag: string | undefined;
  let originalDevAuthOrigins: string | undefined;
  let originalExtraOrigins: string | undefined;

  beforeEach(() => {
    originalFlag = process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH;
    originalDevAuthOrigins = process.env.DEV_AUTH_ALLOWED_ORIGINS;
    originalExtraOrigins = process.env.VIZZOR_EXTRA_ORIGINS;
    // `checkOrigin` (lib/payment/origin-check.ts) reads the staging
    // allow-list from VIZZOR_EXTRA_ORIGINS — opt the staging host in
    // so the positive case isn't blocked by the origin gate.
    process.env.VIZZOR_EXTRA_ORIGINS = 'https://test.vizzor.ai,https://other.example.com';
  });

  afterEach(() => {
    const env = process.env as EnvMutable;
    env.NEXT_PUBLIC_ALLOW_DEV_AUTH = originalFlag;
    env.DEV_AUTH_ALLOWED_ORIGINS = originalDevAuthOrigins;
    env.VIZZOR_EXTRA_ORIGINS = originalExtraOrigins;
  });

  it('returns 404 when NEXT_PUBLIC_ALLOW_DEV_AUTH is unset', async () => {
    const env = process.env as EnvMutable;
    env.NEXT_PUBLIC_ALLOW_DEV_AUTH = undefined;
    const res = await POST(buildRequest({ wallet: VALID_WALLET }));
    expect(res.status).toBe(404);
    // No auth cookie was set on the 404.
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('returns 404 when the flag is set but origin is neither localhost nor allow-listed', async () => {
    const env = process.env as EnvMutable;
    env.NEXT_PUBLIC_ALLOW_DEV_AUTH = 'true';
    env.DEV_AUTH_ALLOWED_ORIGINS = undefined;
    const res = await POST(
      buildRequest({ wallet: VALID_WALLET }, 'https://evil.example.com'),
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 invalid_wallet when wallet is malformed', async () => {
    const env = process.env as EnvMutable;
    env.NEXT_PUBLIC_ALLOW_DEV_AUTH = 'true';
    const res = await POST(buildRequest({ wallet: 'not-a-wallet' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('invalid_wallet');
  });

  it('mints a session + sets the auth cookie on localhost when the flag is on', async () => {
    const env = process.env as EnvMutable;
    env.NEXT_PUBLIC_ALLOW_DEV_AUTH = 'true';
    const res = await POST(buildRequest({ wallet: VALID_WALLET }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      wallet: string;
      expiresAt: number;
    };
    expect(body.ok).toBe(true);
    expect(body.wallet).toBe(VALID_WALLET);
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/vizzor\.auth=|__Host-vizzor\.auth=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/');
    // Localhost: no Secure flag — the dev server is HTTP.
    expect(cookie).not.toContain('Secure');
  });

  it('recognises test.vizzor.ai as a built-in staging origin (no env needed) AND sets the Secure cookie flag', async () => {
    const env = process.env as EnvMutable;
    env.NEXT_PUBLIC_ALLOW_DEV_AUTH = 'true';
    // No DEV_AUTH_ALLOWED_ORIGINS — the built-in staging list inside
    // the route is what lets the staging origin through.
    env.DEV_AUTH_ALLOWED_ORIGINS = undefined;
    const res = await POST(
      buildRequest({ wallet: VALID_WALLET }, 'https://test.vizzor.ai'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; wallet: string };
    expect(body.ok).toBe(true);
    expect(body.wallet).toBe(VALID_WALLET);
    const cookie = res.headers.get('set-cookie') ?? '';
    // Staging is HTTPS — the cookie MUST carry `Secure` so browsers
    // honor it (and so a downgrade attack can't capture it).
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
  });

  it('honours an explicit DEV_AUTH_ALLOWED_ORIGINS entry for non-built-in hosts', async () => {
    const env = process.env as EnvMutable;
    env.NEXT_PUBLIC_ALLOW_DEV_AUTH = 'true';
    env.DEV_AUTH_ALLOWED_ORIGINS = 'https://other.example.com';
    const res = await POST(
      buildRequest({ wallet: VALID_WALLET }, 'https://other.example.com'),
    );
    expect(res.status).toBe(200);
  });

  it('returns 404 when origin matches neither built-in staging nor the explicit allow-list', async () => {
    const env = process.env as EnvMutable;
    env.NEXT_PUBLIC_ALLOW_DEV_AUTH = 'true';
    env.DEV_AUTH_ALLOWED_ORIGINS = 'https://test.vizzor.ai';
    // `other.example.com` is in VIZZOR_EXTRA_ORIGINS (so the outer
    // origin-check passes) but isn't a built-in staging host and isn't
    // in DEV_AUTH_ALLOWED_ORIGINS — the dev-auth gate refuses → 404.
    const res = await POST(
      buildRequest({ wallet: VALID_WALLET }, 'https://other.example.com'),
    );
    expect(res.status).toBe(404);
  });
});
