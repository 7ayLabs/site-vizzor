/**
 * /docs/* — Fumadocs-rendered MDX page.
 *
 * The root slug (`/docs`) is special-cased to render a custom hero +
 * category-grid landing page instead of the default prose layout — see
 * `components/docs/docs-landing.tsx`. Inner doc pages still flow through
 * the standard Fumadocs `DocsPage` shell with the sidebar + TOC.
 *
 * MDX bodies are hydrated with the Vizzor design-system components
 * (TerminalBlock, TierBadge, DataTile, ChainPill, etc.) plus Fumadocs'
 * built-ins. The EN-only banner sits above every inner doc page (the
 * landing handles its own copy in the hero).
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { source } from '@/lib/source';
import {
  TerminalBlock,
  TierBadge,
  DataTile,
  SignalRow,
  ChainPill,
  CoinIcon,
  ChainIcon,
  CopyChip,
} from '@/components/docs/mdx-components';
import { EnOnlyBanner } from '@/components/docs/en-only-banner';
import { DocsLanding } from '@/components/docs/docs-landing';
import { DocsAskPill } from '@/components/docs/docs-ask-pill';

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

function isRootSlug(slug: string[] | undefined): boolean {
  return !slug || slug.length === 0;
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  // Root slug bypasses the prose layout — render the custom landing
  // with the hero, category grid, and floating Telegram pill. The
  // index.mdx source remains the canonical content reference but its
  // prose body is not visually rendered here.
  if (isRootSlug(slug)) {
    return (
      <DocsPage toc={[]}>
        <DocsLanding />
        <DocsAskPill />
      </DocsPage>
    );
  }

  const MDX = page.data.body;
  const toc = Array.isArray(page.data.toc) ? page.data.toc : undefined;

  return (
    <DocsPage toc={toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      {page.data.description ? (
        <DocsDescription>{page.data.description}</DocsDescription>
      ) : null}
      <DocsBody>
        <EnOnlyBanner />
        <MDX
          components={{
            ...defaultMdxComponents,
            TerminalBlock,
            TierBadge,
            DataTile,
            SignalRow,
            ChainPill,
            CoinIcon,
            ChainIcon,
            CopyChip,
          }}
        />
      </DocsBody>
      <DocsAskPill />
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) return {};
  return {
    title: page.data.title,
    description: page.data.description,
  };
}
