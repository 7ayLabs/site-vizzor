import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { createMDX } from 'fumadocs-mdx/next';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');
const withMDX = createMDX();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  typedRoutes: true,
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
};

// Order matters: fumadocs-mdx augments webpack with MDX loaders + the .source
// alias; next-intl wraps everything. Both return a NextConfig.
export default withNextIntl(withMDX(nextConfig));
