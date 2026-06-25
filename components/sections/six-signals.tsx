/**
 * SixSignals — repurposed to "Built for Web3" in Pass 2.
 *
 * The original section listed six SIGNAL families (engine internals). Per
 * user feedback the framing shifted to six WEB3 PILLARS that explain where
 * Vizzor lives in the ecosystem (chains / wallet / billing / surfaces /
 * scoreboard / community).
 *
 * The flagship visual scaffolding stays — left orbital + right column of
 * six rows with IntersectionObserver-driven active highlight — only the
 * row content swaps to pillar copy.
 *
 * Translation keys consumed:
 *   sixSignals.{eyebrow,title,lede,ariaLabel,pillars.<key>.{title,description,reveal}}
 */
import { getTranslations } from 'next-intl/server';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { SixSignalsClient, type SixSignalsRowCopy } from './six-signals.client';

const PILLAR_KEYS = [
  'chains',
  'wallet',
  'billing',
  'surfaces',
  'scoreboard',
  'community',
] as const;

export async function SixSignals() {
  const t = await getTranslations('sixSignals');

  const rows: readonly SixSignalsRowCopy[] = PILLAR_KEYS.map((key) => ({
    key,
    title: t(`pillars.${key}.title`),
    description: t(`pillars.${key}.description`),
    reveal: t(`pillars.${key}.reveal`),
    ariaLabel: t('ariaLabel', { pillar: key }),
  }));

  return (
    <section
      aria-labelledby="six-signals-title"
      className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-24 lg:py-32"
    >
      <GsapHeadline
        className="flex flex-col gap-4 max-w-[60ch]"
        eyebrow={<SectionEyebrow>{t('eyebrow')}</SectionEyebrow>}
        title={t('title')}
        sub={t('lede')}
        titleId="six-signals-title"
        titleClassName="display text-[var(--fg)] text-balance text-[28px] sm:text-[36px] lg:text-[44px] leading-[1.05] tracking-[-0.02em] font-semibold"
        subClassName="text-[var(--fg-2)] max-w-[58ch] leading-relaxed text-[15px] sm:text-[16px]"
      />

      <div className="mt-16">
        <SixSignalsClient rows={rows} />
      </div>
    </section>
  );
}
