/**
 * Locale middleware — runs on every public route, negotiates the locale
 * (Accept-Language header on first visit, URL prefix afterward) and rewrites
 * to the matching `app/[locale]/...` segment.
 *
 * Matcher excludes: API routes, Next internals, Vercel internals, the
 * Fumadocs-hosted `/docs/*` zone (English-only for v0.1.0, lives outside
 * `[locale]`), the global RSS feed at `/changelog/feed.xml`, and any path
 * that ends in a known static-file extension. We anchor the extension
 * pattern to end-of-path so slugs containing dots (e.g. `v0.15.5-helios`)
 * still flow through middleware and get locale-rewritten.
 */
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  matcher: [
    '/((?!api|_next|_vercel|docs|changelog/feed\\.xml|.*\\.(?:ico|png|jpg|jpeg|gif|svg|webp|avif|woff|woff2|otf|ttf|eot|map|js|mjs|cjs|css|json|xml|txt|html|pdf|zip|wasm)$).*)',
  ],
};
