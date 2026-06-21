/**
 * HowItWorks — Bloomberg-meets-Solana three-card terminal grid.
 *
 * Each card is a vt-bracket terminal panel with: a mono `01 / 02 / 03`
 * step number in gold, a `<LiveBadge>`, a `<GlitchHeading>` title, a
 * short description, and a live mini-visual (streaming sparklines /
 * 6-into-1 vote graph / animated A+ stamp with conviction count-up).
 *
 * Reveal + visuals live in `HowItWorksClient`; this shell stays a server
 * component and only forwards translated copy. Horizontal arrows between
 * cards stack to vertical on mobile (collapsed by the grid).
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
      className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-32 lg:py-40"
    >
      <GsapHeadline
        glitch
        className="flex flex-col items-center gap-4 max-w-[60ch] mx-auto text-center"
        eyebrow={<SectionEyebrow align="center">{t('eyebrow')}</SectionEyebrow>}
        title={t('title')}
        sub={t('lede')}
        titleId="how-it-works-title"
        titleClassName="text-3xl lg:text-5xl font-bold tracking-tight text-[var(--fg)]"
        subClassName="text-[var(--fg-2)] max-w-[58ch] mx-auto leading-relaxed"
      />

      <HowItWorksClient steps={steps} arrow="→" />

      <p className="mt-16 text-[12px] mono text-[var(--fg-3)] text-center">
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
