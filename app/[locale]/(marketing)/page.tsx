/**
 * /[locale] — composed home page.
 *
 * Section order: hero → how-it-works → whats-in-it → surface-compare
 * → cta-block.
 *
 * The page is statically generated per locale (see generateStaticParams
 * in the layout); we call `setRequestLocale` here so any nested server
 * components can read the active locale during SSG.
 *
 * Note: `<SixSignals />` ("Built for Web3") is intentionally NOT rendered
 * here — the component file is retained for potential revival but the
 * landing leads with `<WhatsInIt />` (which now carries the per-surface
 * platform cards directly) into the closing CTA. The standalone
 * `<AvailableOn />` section was removed in the polish pass because its
 * Telegram/CLI/Web tiles duplicated what `<WhatsInIt />` already
 * surfaces in-line.
 */

import { setRequestLocale } from 'next-intl/server';
import { Hero } from '@/components/sections/hero';
import { HowItWorks } from '@/components/sections/how-it-works';
import { WhatsInIt } from '@/components/sections/whats-in-it';
import { SurfaceCompare } from '@/components/sections/surface-compare';
import { CtaBlock } from '@/components/sections/cta-block';

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <Hero />
      <HowItWorks />
      <WhatsInIt />
      <SurfaceCompare />
      <CtaBlock />
    </>
  );
}
