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
import { localeForCountry, readEdgeCountry } from './i18n/detect';

const localeMiddleware = createMiddleware(routing);

// Path prefixes that indicate the visitor already picked (or was already
// routed to) a locale — skip geo detection in that case.
const LOCALE_PREFIX_RE = new RegExp(
  `^/(?:${routing.locales.join('|')})(?:/|$)`,
);

/**
 * First-visit geo redirect. Runs BEFORE next-intl's own negotiation so
 * we can land Latin-American visitors on `/es/...` and French-speaking
 * core countries on `/fr/...` before the page renders.
 *
 * Conditions that skip the redirect (return null = let next-intl handle):
 *   - URL already starts with a known locale prefix.
 *   - Visitor has a `NEXT_LOCALE` cookie (explicit choice, respect it).
 *   - Geo header missing (dev, non-edge deploy, allowlisted region).
 *   - Country maps to the default locale ('en') — no redirect needed
 *     because next-intl's `as-needed` strategy puts `en` at the root.
 */
function geoRedirect(req: NextRequest): NextResponse | null {
  const { pathname, search } = req.nextUrl;
  if (LOCALE_PREFIX_RE.test(pathname)) return null;
  if (req.cookies.has('NEXT_LOCALE')) return null;
  const country = readEdgeCountry(req.headers);
  const target = localeForCountry(country);
  if (!target || target === routing.defaultLocale) return null;
  // Build the locale-prefixed URL and redirect with 307 — temporary so
  // search engines don't cache the country→locale mapping (different
  // visitors at the same URL should still get their own routing).
  const url = req.nextUrl.clone();
  url.pathname = pathname === '/' ? `/${target}` : `/${target}${pathname}`;
  url.search = search;
  const res = NextResponse.redirect(url, 307);
  // Persist the choice so subsequent visits skip detection and lock to
  // the URL prefix the visitor has now committed to.
  res.cookies.set('NEXT_LOCALE', target, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  return res;
}

const PROD = process.env.NODE_ENV === 'production';

/**
 * Hostnames that route the visitor directly into the product shell
 * (`/app/*`) instead of the marketing surface. The single Next.js
 * process serves both — this middleware just rewrites the requested
 * path into the `/app/*` segment for these hosts.
 *
 * Configurable via `APP_HOSTS` env (comma-separated) so staging can
 * use a different subdomain (e.g. `app.staging.vizzor.ai`) without
 * a code change.
 */
// `testapp.vizzor.ai` is the staging twin of `app.vizzor.ai` — same
// host-rewrite behavior (mounts /app/* as /), but points at the test
// container so QA and demo flows stay sealed off from prod. Mirror
// this list with `APP_ONLY_HOSTS` in `app/[locale]/app/layout.tsx`.
const DEFAULT_APP_HOSTS = ['app.vizzor.ai', 'testapp.vizzor.ai'];
const APP_HOSTS = new Set(
  (process.env.APP_HOSTS ?? DEFAULT_APP_HOSTS.join(','))
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

/** Path prefixes the host-rewrite must NOT touch — even on app.*
 *  these should pass through unchanged. The marketing-route bypasses
 *  (account, pricing, pay, wallet, cli-pair, telegram-pair, legal,
 *  blog) belong to the marketing route group but are reachable
 *  from inside the product (profile dropdown, exhausted-banner
 *  upgrade CTA, wallet redirect target, pairing flows, legal/privacy
 *  links, blog island) — the visitor stays on `app.vizzor.ai`
 *  end-to-end instead of bouncing to vizzor.ai. The marketing layout
 *  detects the app host and strips its chrome so these pages render
 *  in app-style on the product subdomain.
 *
 *  `changelog` is still listed so legacy URLs that hit the app host
 *  (e.g. bookmarks on app.vizzor.ai/changelog) reach the 308 redirect
 *  declared in next.config.ts rather than being app-host-rewritten
 *  into /app/changelog (which 404s). */
const HOST_REWRITE_BYPASS_RE =
  /^\/(?:api|_next|_vercel|docs|favicon\.ico|sitemap\.xml|robots\.txt|manifest\.webmanifest|account|pricing|pay|wallet|cli-pair|telegram-pair|legal|blog|changelog)(?:\/|$)/;

/**
 * On `app.vizzor.ai`, mutate the URL pathname in place so the rest
 * of the middleware pipeline (geo → next-intl locale negotiation →
 * security headers) sees the `/app/*` path and routes it through the
 * `[locale]/app/...` segment correctly. The function returns true if
 * a rewrite was applied; callers don't need the return value but it's
 * useful for tests.
 *
 *   app.vizzor.ai/                  → (mutated to) /app/predict
 *   app.vizzor.ai/predict           → /app/predict
 *   app.vizzor.ai/predict/abc       → /app/predict/abc
 *   app.vizzor.ai/billing           → /app/billing
 *   app.vizzor.ai/es/predict        → /es/app/predict (locale preserved)
 *
 * MUST mutate in place rather than return a terminal NextResponse:
 * next-intl's localeMiddleware downstream reads req.nextUrl.pathname
 * to decide whether to inject the default locale prefix. Returning
 * early with `NextResponse.rewrite(/app/predict)` bypasses next-intl,
 * leaving the URL without a `[locale]` segment — which 404s because
 * every route file lives under `app/[locale]/...`.
 */
function applyAppHostRewriteInPlace(req: NextRequest): boolean {
  const hostHeader = (req.headers.get('host') ?? '').toLowerCase();
  const host = hostHeader.split(':')[0] ?? '';
  if (!APP_HOSTS.has(host)) return false;

  const { pathname } = req.nextUrl;
  if (HOST_REWRITE_BYPASS_RE.test(pathname)) return false;

  const localeMatch = pathname.match(
    new RegExp(`^/(${routing.locales.filter((l) => l !== routing.defaultLocale).join('|')})(?=/|$)`),
  );
  const localePrefix = localeMatch ? localeMatch[0] : '';
  const rest = pathname.slice(localePrefix.length);
  if (rest.startsWith('/app')) return false;

  const nextRest = rest === '' || rest === '/'
    ? '/app/predict'
    : `/app${rest}`;

  const newPathname = `${localePrefix}${nextRest}`;
  if (newPathname === pathname) return false;
  req.nextUrl.pathname = newPathname;
  return true;
}

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
    // Cloudflare auto-injects its Web Analytics beacon
    // (`static.cloudflareinsights.com/beacon.min.js`) on every HTML
    // response from a proxied domain. Without the allowlist, the CSP
    // blocks the script and produces noisy violations in the console.
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      'https://static.cloudflareinsights.com',
    ],
    // `@solana/wallet-adapter-react-ui/styles.css` (bundled with the
    // wallet adapter we import in `components/wallet/wallet-provider.tsx`)
    // contains `@import url("https://fonts.googleapis.com/...")` for
    // DM Sans. Allowing the Google Fonts CSS origin is the lower-risk
    // option vs forking the upstream package.
    'style-src': [
      "'self'",
      "'unsafe-inline'",
      'https://fonts.googleapis.com',
    ],
    // `https://fonts.gstatic.com` serves the `.woff2` files referenced
    // by the Google Fonts CSS above.
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
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
      // Cloudflare Insights beacon reporting endpoint — paired with the
      // `script-src` allow-listing of `static.cloudflareinsights.com`.
      'https://cloudflareinsights.com',
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
 * Public-asset path that crawlers from wallet vendors fetch
 * cross-origin (TonConnect manifest crawled by Tonkeeper / TON Space;
 * RFC 9116 security.txt occasionally checked by reputation services).
 * These need permissive CORS + relaxed CORP so the fetch succeeds.
 */
const CROSS_ORIGIN_PUBLIC_PATHS = new Set<string>([
  '/tonconnect-manifest.json',
  '/.well-known/security.txt',
  '/security.txt',
]);

/**
 * Relax CORS + CORP on the cross-origin public paths so wallet
 * vendors (TonConnect crawler, Phantom domain classifier) and the
 * security-disclosure crawlers can fetch them without the same-site
 * CORP block. We don't widen anything else — the allowlist is
 * explicit and tiny.
 */
function applyPublicAssetCors(res: NextResponse): NextResponse {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // Override the same-site CORP set by applySecurityHeaders so the
  // cross-origin fetch isn't blocked at the browser. The manifest +
  // security.txt are intentionally public; no risk in relaxing CORP
  // for these specific paths.
  res.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return res;
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

  // CSP — Report-Only for staging / devnet; enforcing for production
  // mainnet. The Report-Only header still ships in prod alongside the
  // enforcing one so the report endpoint keeps catching the long tail.
  const csp = buildCsp();
  const isMainnetProd =
    PROD &&
    (process.env.NEXT_PUBLIC_PAYMENT_NETWORK === 'mainnet' ||
      process.env.CSP_ENFORCE === 'true');
  if (isMainnetProd) {
    res.headers.set('Content-Security-Policy', csp);
  } else {
    res.headers.set('Content-Security-Policy-Report-Only', csp);
  }

  return res;
}

export default function middleware(req: NextRequest): NextResponse {
  // 0. App-host rewrite — mutates req.nextUrl.pathname in place when
  //    the visitor is on `app.vizzor.ai`. The rest of the pipeline
  //    (geo → locale → security headers) then processes the rewritten
  //    path and next-intl injects the correct `[locale]` segment.
  applyAppHostRewriteInPlace(req);

  // Only run the next-intl locale handler against paths it owns.
  // Everything else flows through unchanged and just collects the
  // security headers on its way out.
  const { pathname } = req.nextUrl;
  const skipLocale =
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/_vercel') ||
    pathname.startsWith('/docs') ||
    pathname === '/blog/feed.xml' ||
    pathname === '/changelog/feed.xml' ||
    /\.(?:ico|png|jpg|jpeg|gif|svg|webp|avif|woff|woff2|otf|ttf|eot|map|js|mjs|cjs|css|json|xml|txt|html|pdf|zip|wasm)$/.test(
      pathname,
    );

  if (skipLocale) {
    const res = applySecurityHeaders(NextResponse.next());
    if (CROSS_ORIGIN_PUBLIC_PATHS.has(pathname)) {
      applyPublicAssetCors(res);
    }
    return res;
  }

  // Geo-based first-visit redirect runs BEFORE next-intl negotiation.
  // When it returns a redirect we apply the security headers to that
  // response and short-circuit; the redirect target will re-enter this
  // middleware on the next hop where the locale prefix is present and
  // both checks no-op cleanly.
  const geo = geoRedirect(req);
  if (geo) return applySecurityHeaders(geo);

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
