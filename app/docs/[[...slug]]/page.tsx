/**
 * /docs/* — Fumadocs-rendered MDX page.
 *
 * Loads the matching page from the MDX source map, hydrates the body with
 * Vizzor's design-system MDX components (TerminalBlock, TierBadge, DataTile,
 * ChainPill, etc.) plus Fumadocs' built-ins, and shows the EN-only banner
 * at the top of every doc page (callable from MDX as <EnOnlyBanner />).
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

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

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
