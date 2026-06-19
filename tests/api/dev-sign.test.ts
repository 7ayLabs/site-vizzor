/**
 * POST /api/auth/dev-sign — dev-only auth bypass.
 *
 * The route is triple-gated. These tests assert the gates fail closed
 * — production callers MUST see 404, never a session cookie. The
 * positive case temporarily flips NODE_ENV + the flag + uses a
 * localhost Origin so the gate passes and verifies a proper auth
 * cookie comes back.
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
  let originalNodeEnv: string | undefined;
  let originalFlag: string | undefined;
  let originalAllowedOrigins: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalFlag = process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH;
    originalAllowedOrigins = process.env.NEXT_PUBLIC_ALLOWED_ORIGINS;
    // origin-check needs to allow localhost:3000 for the positive case.
    process.env.NEXT_PUBLIC_ALLOWED_ORIGINS = 'http://localhost:3000';
  });

  afterEach(() => {
    const env = process.env as EnvMutable;
    env.NODE_ENV = originalNodeEnv;
    env.NEXT_PUBLIC_ALLOW_DEV_AUTH = originalFlag;
    env.NEXT_PUBLIC_ALLOWED_ORIGINS = originalAllowedOrigins;
  });

  it('returns 404 when NODE_ENV is not development', async () => {
    const env = process.env as EnvMutable;
    env.NODE_ENV = 'production';
    env.NEXT_PUBLIC_ALLOW_DEV_AUTH = 'true';
    const res = await POST(buildRequest({ wallet: VALID_WALLET }));
    expect(res.status).toBe(404);
    // No auth cookie was set on the 404.
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('returns 404 when NEXT_PUBLIC_ALLOW_DEV_AUTH is unset', async () => {
    const env = process.env as EnvMutable;
    env.NODE_ENV = 'development';
    env.NEXT_PUBLIC_ALLOW_DEV_AUTH = undefined;
    const res = await POST(buildRequest({ wallet: VALID_WALLET }));
    expect(res.status).toBe(404);
  });

  it('returns 404 when origin is not localhost', async () => {
    const env = process.env as EnvMutable;
    env.NODE_ENV = 'development';
    env.NEXT_PUBLIC_ALLOW_DEV_AUTH = 'true';
    const res = await POST(
      buildRequest({ wallet: VALID_WALLET }, 'https://evil.example.com'),
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 invalid_wallet when wallet is malformed', async () => {
    const env = process.env as EnvMutable;
    env.NODE_ENV = 'development';
    env.NEXT_PUBLIC_ALLOW_DEV_AUTH = 'true';
    const res = await POST(buildRequest({ wallet: 'not-a-wallet' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('invalid_wallet');
  });

  it('mints a session + sets the auth cookie when all gates pass', async () => {
    const env = process.env as EnvMutable;
    env.NODE_ENV = 'development';
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
  });
});
