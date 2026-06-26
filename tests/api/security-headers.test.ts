/**
 * Global security headers — placeholder for the dedicated test pass.
 *
 * The middleware at `/middleware.ts` (already shipped) attaches a
 * canonical set of headers — HSTS, X-Frame-Options, X-Content-Type-
 * Options, Referrer-Policy, Permissions-Policy, COOP, CORP, and CSP
 * (currently `Content-Security-Policy-Report-Only`). The plan
 * (§P1 / API hardening) promotes the CSP to enforcing in a
 * follow-up and adds a per-request nonce for inline scripts.
 *
 * This file documents the contract the upgraded middleware must
 * uphold. We keep every assertion as `it.todo` for now because:
 *
 *   1. Next.js middleware runs in the Edge runtime, which Vitest's
 *      default Node environment does NOT load with `NextRequest`'s
 *      full geo/header surface — exercising it requires either the
 *      `@edge-runtime/vm` Vitest environment or a Playwright pass
 *      against the dev server. Both are queued for v0.4.x.
 *   2. The Phase-2 enforcing CSP swap is part of the post-flip
 *      hardening sprint, not the mainnet flip itself.
 *
 * Promotion plan (payment-qa, v0.4.x):
 *   - Add `@edge-runtime/vm` as a devDep
 *   - Spin up the middleware via `runMiddleware(req)` with a fake
 *     `NextRequest` for `/pay/pro/monthly`, `/api/health`,
 *     `/api/payment/session`, and `/`
 *   - Assert each response carries every header in the contract
 *   - Assert the CSP allowlist matches the documented set in
 *     `middleware.ts::buildCsp` exactly (no drift)
 */

import { describe, it } from 'vitest';

describe('Global security headers (placeholder — promoted in v0.4.x with @edge-runtime/vm)', () => {
  describe('headers on every response', () => {
    it.todo('Strict-Transport-Security with 2y max-age + includeSubDomains + preload (prod only)');
    it.todo('X-Content-Type-Options: nosniff');
    it.todo('X-Frame-Options: SAMEORIGIN (wallet in-app browser compat)');
    it.todo('Referrer-Policy: strict-origin-when-cross-origin');
    it.todo('Permissions-Policy disables camera, microphone, geolocation, payment, usb, sensors');
    it.todo('Cross-Origin-Opener-Policy: same-origin');
    it.todo('Cross-Origin-Resource-Policy: same-site');
  });

  describe('content security policy', () => {
    it.todo('Content-Security-Policy-Report-Only is present in Phase 1');
    it.todo('default-src is restricted to self');
    it.todo('object-src is none');
    it.todo("frame-ancestors is 'self' (not 'none')");
    it.todo('connect-src includes api.vizzor.ai + *.solana.com + *.helius-rpc.com');
    it.todo('report-uri points at /api/security/csp-report');
    it.todo('upgrade-insecure-requests is set in production only');
    it.todo('Phase 2: enforcing CSP swap replaces the report-only header');
  });

  describe('scope', () => {
    it.todo('headers ride on /pay/* responses');
    it.todo('headers ride on /api/* responses (catch-all matcher)');
    it.todo('headers ride on the locale-rewritten /es/pay/pro/monthly response');
    it.todo('headers ride on geo-redirect responses (307 first-visit redirects)');
  });
});
