/**
 * HowItWorks — three feature-mock cards in a 3-column grid.
 *
 * Composition follows the reference dashboard "How it works" pattern:
 * each card has a step number, a bold title, a short descriptive
 * paragraph, and a substantial product-mockup visual that takes the
 * bottom half of the card. The visual carries the explanation — the
 * text just frames it.
 *
 * Style vocabulary matches the hero data cards (corner brackets,
 * scanline overlay, hairline borders, mono typography). No chromatic
 * accents — strict monochrome with the scoped --up/--down direction
 * tokens used only on actual hit/miss glyphs.
 *
 * Drops the prior arrow-separator layout (felt like a flowchart
 * diagram, not feature cards) and the per-card LiveBadge + glitch
 * heading noise (the live state lives on the hero, not here).
 */
import { getTranslations } from 'next-intl/server';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { Link } from '@/i18n/navigation';
import { HowItWorksClient } from './how-it-works.client';

type StepKey = 'fetch' | 'fuse' | 'emit';

interface StepSpec {
  key: StepKey;
  number: string;
}

const STEPS: readonly [StepSpec, StepSpec, StepSpec] = [
  { key: 'fetch', number: '01' },
  { key: 'fuse', number: '02' },
  { key: 'emit', number: '03' },
];

export async function HowItWorks() {
  const t = await getTranslations('howItWorks');

  const steps = STEPS.map((s) => ({
    number: s.number,
    title: t(`steps.${s.key}.title`),
    description: t(`steps.${s.key}.description`),
  })) as unknown as Readonly<
    [
      { number: string; title: string; description: string },
      { number: string; title: string; description: string },
      { number: string; title: string; description: string },
    ]
  >;

  return (
    <section
      aria-labelledby="how-it-works-title"
      className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-24 lg:py-32"
    >
      <GsapHeadline
        className="flex flex-col items-center gap-4 max-w-[60ch] mx-auto text-center"
        eyebrow={<SectionEyebrow align="center">{t('eyebrow')}</SectionEyebrow>}
        title={t('title')}
        sub={t('lede')}
        titleId="how-it-works-title"
        titleClassName="display text-[var(--fg)] text-balance text-[32px] sm:text-[44px] lg:text-[56px] leading-[1.02] tracking-[-0.025em] font-semibold"
        subClassName="text-[var(--fg-2)] max-w-[58ch] mx-auto leading-relaxed text-[15px] sm:text-[16px]"
      />

      <HowItWorksClient steps={steps} />

      <p className="mt-14 text-[12px] mono text-[var(--fg-3)] text-center">
        <Link
          href="/docs/chronovisor"
          className="underline-offset-4 hover:text-[var(--fg)] hover:underline transition-colors"
        >
          {t('footer')}
        </Link>
      </p>
    </section>
  );
}
