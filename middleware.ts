/**
 * Locale + security-headers middleware.
 *
 * Two responsibilities, applied in this order:
 *
 *   1. **Security headers**: attach a canonical set of defensive
 *      headers (HSTS, X-Frame-Options, X-Content-Type-Options,
 *      Referrer-Policy, Permissions-Policy, CSP, COOP, CORP) to every
 *      response the app emits. The CSP starts in *Report-Only* mode
 *      so a real session against staging can fill in the allowlist
 *      before we promote to enforcing in a follow-up commit.
 *
 *   2. **Locale negotiation**: rewrite the URL into the right
 *      `app/[locale]/...` segment via next-intl. Same matcher as
 *      before — excludes API routes, Next internals, the docs zone,
 *      RSS feed, and static-extension paths.
 *
 * The single matcher covers everything next-intl needs; we wrap its
 * response so the headers ride on the locale-rewritten response too.
 * For paths the matcher excludes (API routes, static), we still want
 * security headers — handled by a wider `headerMatcher` that runs the
 * header pass even when locale rewriting is a no-op.
 *
 * CSP rollout discipline (per the security plan §A1):
 *   - Phase 1 (this commit): `Content-Security-Policy-Report-Only`
 *     pointed at `/api/security/csp-report` so we can collect a real
 *     allowlist from a staging session without breaking the app.
 *   - Phase 2 (follow-up): promote to enforcing `Content-Security-Policy`
 *     after a 7-day report-only window with no false positives.
 */

import { NextResponse, type NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const localeMiddleware = createMiddleware(routing);

const PROD = process.env.NODE_ENV === 'production';

/**
 * Build the CSP directive string. Keeps the allowlist in one place so
 * Phase 2 (promotion to enforcing) is a one-line flip.
 *
 * Notes on the allowlist:
 *   - `'unsafe-inline'` on `style-src` is required by Tailwind v4's
 *     runtime style injection and the wallet adapter's modal CSS.
 *     We accept the trade-off for v0.2.x; a future hardening pass
 *     can move to nonce-driven inline styles.
 *   - The theme-boot script in `theme-provider.tsx` runs as an
 *     unkeyed inline script. We allow it via `'unsafe-inline'` on
 *     `script-src` only in Report-Only mode; the Phase 2 commit
 *     switches that to a per-request nonce.
 *   - `img-src` includes the icon CDN fallback (`cdn.jsdelivr.net`)
 *     and CoinGecko's hosted images (in case a future entry uses
 *     the CDN directly instead of being mirrored to `public/coins/`).
 *   - `connect-src` covers the live API (`api.vizzor.ai`), the
 *     Solana RPC providers we accept, and the WebSocket variant of
 *     those RPCs.
 */
function buildCsp(): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    // SAMEORIGIN, not 'none'. Wallet in-app browsers (Phantom, Solflare)
    // render dapps inside an embedded WebView that the OS treats as a
    // same-origin frame; `'none'` blanks the page (about:blank). The
    // cross-origin clickjacking threat — a third-party site iframe-
    // embedding Vizzor — is still blocked.
    'frame-ancestors': ["'self'"],
    'form-action': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'font-src': ["'self'", 'data:'],
    'img-src': [
      "'self'",
      'data:',
      'blob:',
      'https://cdn.jsdelivr.net',
      'https://coin-images.coingecko.com',
      'https://assets.coingecko.com',
      'https://icons.llamao.fi',
    ],
    'connect-src': [
      "'self'",
      'https://api.vizzor.ai',
      'https://*.solana.com',
      'wss://*.solana.com',
      'https://solana-rpc.publicnode.com',
      'https://*.helius-rpc.com',
      'https://api.coingecko.com',
    ],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'report-uri': ['/api/security/csp-report'],
  };
  if (PROD) directives['upgrade-insecure-requests'] = [];
  return Object.entries(directives)
    .map(([k, v]) => (v.length === 0 ? k : `${k} ${v.join(' ')}`))
    .join('; ');
}

/**
 * Attach security headers to an arbitrary response in place. Used for
 * both the locale-rewritten response and the static-pass response.
 */
function applySecurityHeaders(res: NextResponse): NextResponse {
  // HSTS — force HTTPS for 2 years. Only meaningful in prod (cert
  // exists); harmless on localhost but we skip to avoid confusion
  // when a developer points another browser at 127.0.0.1.
  if (PROD) {
    res.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    );
  }

  res.headers.set('X-Content-Type-Options', 'nosniff');
  // SAMEORIGIN, not DENY. See the `frame-ancestors` directive above —
  // wallet in-app browsers need same-origin framing to render the dapp.
  // Cross-origin iframe embedding (the real clickjacking threat) is
  // still refused.
  res.headers.set('X-Frame-Options', 'SAMEORIGIN');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
  );
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.headers.set('Cross-Origin-Resource-Policy', 'same-site');

  // CSP — Report-Only for Phase 1. Switch to `Content-Security-Policy`
  // for enforcing in Phase 2.
  res.headers.set('Content-Security-Policy-Report-Only', buildCsp());

  return res;
}

export default function middleware(req: NextRequest): NextResponse {
  // Only run the next-intl locale handler against paths it owns.
  // Everything else flows through unchanged and just collects the
  // security headers on its way out.
  const { pathname } = req.nextUrl;
  const skipLocale =
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/_vercel') ||
    pathname.startsWith('/docs') ||
    pathname === '/changelog/feed.xml' ||
    /\.(?:ico|png|jpg|jpeg|gif|svg|webp|avif|woff|woff2|otf|ttf|eot|map|js|mjs|cjs|css|json|xml|txt|html|pdf|zip|wasm)$/.test(
      pathname,
    );

  if (skipLocale) {
    return applySecurityHeaders(NextResponse.next());
  }

  const localeRes = localeMiddleware(req);
  // `localeMiddleware` always returns a NextResponse-compatible object
  // (rewrite, redirect, or next). Layering headers onto it preserves
  // the rewrite target.
  return applySecurityHeaders(localeRes as NextResponse);
}

export const config = {
  matcher: [
    // Catch-all so security headers also land on API and static paths.
    // The locale handler short-circuits for non-locale paths above.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
