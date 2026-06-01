import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { createMDX } from 'fumadocs-mdx/next';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');
const withMDX = createMDX();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  typedRoutes: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'assets.coincap.io', pathname: '/assets/icons/**' },
      { protocol: 'https', hostname: 'icons.llamao.fi', pathname: '/icons/**' },
    ],
  },
};

// Order matters: fumadocs-mdx augments webpack with MDX loaders + the .source
// alias; next-intl wraps everything. Both return a NextConfig.
export default withNextIntl(withMDX(nextConfig));
