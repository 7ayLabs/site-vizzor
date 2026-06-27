import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { createMDX } from 'fumadocs-mdx/next';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');
const withMDX = createMDX();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  typedRoutes: true,
  // Native Node modules used by the payment subsystem. Without this,
  // `instrumentation.ts` (which dynamic-imports lib/payment/* on the
  // Node runtime) fails the edge-runtime build with "Module not found:
  // Can't resolve 'fs'/'path'" because webpack walks the full import
  // graph regardless of runtime guards. Marking better-sqlite3 as
  // external tells Next.js to `require()` it at runtime instead of
  // bundling — the standalone output still ships it via node_modules.
  serverExternalPackages: ['better-sqlite3', 'bindings'],
  // Hide the small floating `N` chip Next.js renders in the corner
  // while running `next dev`. It overlapped the marketing layout's
  // own bottom-left affordances and read as a stray brand mark to
  // anyone screenshotting the site.
  devIndicators: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.jsdelivr.net', pathname: '/gh/atomiclabs/cryptocurrency-icons/**' },
      { protocol: 'https', hostname: 'icons.llamao.fi', pathname: '/icons/**' },
    ],
  },
  // Legacy app-surface URLs → new /app/* umbrella. 308 (permanent)
  // preserves SEO + browser history; handled at the edge before any
  // route resolution. Per-locale variants explicit because next-intl's
  // `as-needed` localePrefix puts `en` at the root.
  //
  // `/changelog` → `/blog` follows the same shape: the section was
  // renamed (and broadened from release-notes-only to editorial +
  // release-notes) in this commit, but operators may have bookmarks
  // and the old RSS feed URL is in third-party readers. 308 keeps
  // every legacy link live and tells crawlers the move is permanent.
  async redirects() {
    return [
      // English (root) — preserves the canonical /predict, /dashboard/*
      // URLs that have been live since v0.1.0.
      { source: '/predict', destination: '/app/predict', permanent: true },
      { source: '/dashboard', destination: '/app', permanent: true },
      { source: '/dashboard/flow', destination: '/app/flow', permanent: true },
      { source: '/dashboard/whales', destination: '/app/whales', permanent: true },
      // Localized variants (es, fr) — must enumerate per next-intl
      // `as-needed` strategy; we don't redirect for unknown locales so
      // a typo doesn't 308 into a 404 trap.
      { source: '/:locale(es|fr)/predict', destination: '/:locale/app/predict', permanent: true },
      { source: '/:locale(es|fr)/dashboard', destination: '/:locale/app', permanent: true },
      { source: '/:locale(es|fr)/dashboard/flow', destination: '/:locale/app/flow', permanent: true },
      { source: '/:locale(es|fr)/dashboard/whales', destination: '/:locale/app/whales', permanent: true },
      // Changelog → blog rename. RSS feed gets its own entry above the
      // wildcard so the more-specific path matches first.
      { source: '/changelog/feed.xml', destination: '/blog/feed.xml', permanent: true },
      { source: '/changelog', destination: '/blog', permanent: true },
      { source: '/changelog/:slug', destination: '/blog/:slug', permanent: true },
      { source: '/:locale(es|fr)/changelog/feed.xml', destination: '/blog/feed.xml', permanent: true },
      { source: '/:locale(es|fr)/changelog', destination: '/:locale/blog', permanent: true },
      { source: '/:locale(es|fr)/changelog/:slug', destination: '/:locale/blog/:slug', permanent: true },
    ];
  },
};

// Order matters: fumadocs-mdx augments webpack with MDX loaders + the .source
// alias; next-intl wraps everything. Both return a NextConfig.
export default withNextIntl(withMDX(nextConfig));
