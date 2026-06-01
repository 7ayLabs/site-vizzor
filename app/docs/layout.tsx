/**
 * /docs zone layout.
 *
 * Lives OUTSIDE the `[locale]` segment for two reasons:
 *   1. Docs are English-only for v0.1.0 (per scope decision in spec §B.5.6) —
 *      shipping deep technical content as ES + FR is a v0.2 effort.
 *   2. Fumadocs ships its own router and theming; nesting it under a dynamic
 *      `[locale]` adds friction with no payoff while the EN-only constraint
 *      holds.
 *
 * The non-English locales link to `/docs/*` as-is. A small banner on each
 * page tells visitors the docs are EN-only for now.
 */

import type { ReactNode } from 'react';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { RootProvider } from 'fumadocs-ui/provider';
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { source } from '@/lib/source';
import { sans, mono } from '../fonts';
import { ThemeProvider, themeBootScript } from '@/components/layout/theme-provider';

// docs.css is self-contained — it imports Tailwind, source-scans Fumadocs,
// declares the design tokens, and brings the Fumadocs preset in. The
// marketing `globals.css` is intentionally NOT imported here.
import './docs.css';
import 'katex/dist/katex.css';

const baseOptions: BaseLayoutProps = {
  nav: {
    title: 'Vizzor',
    url: '/',
  },
  githubUrl: 'https://github.com/7ayLabs/vizzor',
};

export default function DocsRootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable}`}
    >
      <head>
        <script
          // Pre-React boot to keep docs in sync with the site theme without
          // a flash. Same script used by `app/[locale]/layout.tsx`.
          dangerouslySetInnerHTML={{ __html: themeBootScript }}
        />
      </head>
      <body className="min-h-dvh antialiased">
        <ThemeProvider>
          <RootProvider>
            <DocsLayout
              tree={source.pageTree}
              {...baseOptions}
              sidebar={{
                defaultOpenLevel: 1,
              }}
            >
              {children}
            </DocsLayout>
          </RootProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
