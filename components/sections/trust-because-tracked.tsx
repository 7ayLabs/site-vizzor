/**
 * TrustBecauseTracked — quieter receipts proof block.
 *
 * Ollama "your data stays yours" pattern: two columns, both visually
 * restrained. Left column hosts a smaller WRRing (180px) centered on its
 * own. Right column renders the 4-tier ladder as plain rows separated by
 * hairline `border-t` lines — no card surfaces, no per-row borders. The
 * descriptive copy for each tier is the product's contract with its users
 * about what each badge means, so it stays locked in the file.
 *
 * Server component: pure data read + render, no client state.
 */
import { getTranslations } from 'next-intl/server';
import type { Tier } from '@/lib/types';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { TierBadge } from '@/components/ui/tier-badge';
import { WRRing } from '@/components/ui/wr-ring';
import { MotionReveal } from '@/components/ui/motion-reveal';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { getTrackerWR } from '@/lib/snapshot';
import { formatPct } from '@/lib/utils';
import { cn } from '@/lib/utils';

type TierKey = 'highConviction' | 'whaleConfirmed' | 'tracked' | 'advisory';

interface TierRowSpec {
  tier: Tier;
  key: TierKey;
}

const TIER_ROWS: readonly TierRowSpec[] = [
  { tier: 'high-conviction', key: 'highConviction' },
  { tier: 'whale-confirmed', key: 'whaleConfirmed' },
  { tier: 'tracked', key: 'tracked' },
  { tier: 'advisory', key: 'advisory' },
];

export async function TrustBecauseTracked() {
  const t = await getTranslations('trustBecauseTracked');
  const wr = getTrackerWR();

  return (
    <section
      aria-labelledby="trust-because-tracked-title"
      className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-32 lg:py-40"
    >
      <GsapHeadline
        className="flex flex-col gap-3 max-w-[60ch]"
        eyebrow={<SectionEyebrow>{t('eyebrow')}</SectionEyebrow>}
        title={t('title')}
        titleId="trust-because-tracked-title"
        titleClassName="text-3xl lg:text-5xl font-bold tracking-tight text-[var(--fg)]"
      />

      <div className="mt-20 grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-16 items-start">
        {/* Left — headline ring */}
        <MotionReveal delay={0}>
          <div className="flex flex-col items-center justify-center">
            <WRRing
              percent={wr.aggregate.wr}
              samples={wr.aggregate.samples}
              size={180}
              label={t('ringLabel')}
            />
            <p className="mt-6 mono tabular text-center text-[11px] text-[var(--fg-3)]">
              {t('ringCaption')}
            </p>
          </div>
        </MotionReveal>

        {/* Right — tier ladder as quiet rows */}
        <MotionReveal delay={120}>
          <div className="flex flex-col gap-4">
            <SectionEyebrow>{t('ladderEyebrow')}</SectionEyebrow>
            <div className="flex flex-col">
              {TIER_ROWS.map((row, index) => {
                const bucket = wr.byTier[row.tier];
                return (
                  <div
                    key={row.tier}
                    className={cn(
                      'flex items-baseline justify-between gap-8 py-4',
                      index === 0
                        ? 'border-t-0'
                        : 'border-t border-[var(--border)]',
                    )}
                  >
                    <div className="flex items-baseline gap-3 min-w-0">
                      <TierBadge tier={row.tier} size="sm" showLabel={false} />
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-sm font-semibold text-[var(--fg)] leading-none">
                          {t(`tiers.${row.key}.name`)}
                        </span>
                        <span className="text-[13px] text-[var(--fg-2)] leading-snug">
                          {t(`tiers.${row.key}.description`)}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="mono tabular text-base font-bold text-[var(--fg)] leading-none">
                        {formatPct(bucket.wr, 1).replace('+', '')}
                      </span>
                      <span className="mono tabular text-[10px] text-[var(--fg-3)] leading-none">
                        n={bucket.samples.toLocaleString('en-US')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </MotionReveal>
      </div>
    </section>
  );
}
