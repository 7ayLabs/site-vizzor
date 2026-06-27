/**
 * TrustBecauseTracked — "Real receipts. Real traders."
 *
 * Centerpiece: a `<LastPredictionCard variant="feature">` showing the
 * freshest confirmed call (asset, direction, outcome chip, confidence,
 * relative timestamp). Replaces the prior aggregate `<WRRing>` so the
 * proof is a single auditable receipt rather than a percentage.
 *
 * Around it: four community-proof DataTiles (traders / calls logged /
 * chains / hidden) stay — they're the "scale" signal that the receipt
 * lives inside.
 *
 * Background: `<RibbonHeat>` at ~20% opacity + scoped `<ScanlineOverlay>`
 * preserve the visual atmosphere; we drive the ribbon from a snapshot
 * tracker number purely for the ribbon's own wave shape (it does not
 * surface a WR figure to the viewer).
 *
 * Translation keys consumed:
 *   trustBecauseTracked.{eyebrow,title,lede,proofEyebrow,
 *                        proof.<key>.{name,value,description}}
 */
import { getTranslations } from 'next-intl/server';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { DataTile } from '@/components/ui/data-tile';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { ScanlineOverlay } from '@/components/ui/scanline-overlay';
import { getTrackerWR } from '@/lib/snapshot';
import { LastPredictionCard } from './last-prediction-card';
import { TrustRibbonBackground } from './trust-because-tracked.client';

const PROOF_KEYS = ['traders', 'calls', 'chains', 'hidden'] as const;

export async function TrustBecauseTracked() {
  const t = await getTranslations('trustBecauseTracked');
  // Snapshot WR drives the ribbon shape only — never rendered as text.
  const ribbonWR = getTrackerWR().aggregate.wr;

  return (
    <section
      aria-labelledby="trust-because-tracked-title"
      className="relative isolate overflow-hidden"
    >
      <TrustRibbonBackground wr={ribbonWR} height={400} />
      <ScanlineOverlay opacity={0.5} />

      <div className="relative z-10 mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-20 md:py-28 lg:py-32">
        <GsapHeadline
          glitch
          className="flex flex-col items-center gap-3 max-w-[60ch] mx-auto text-center"
          eyebrow={<SectionEyebrow align="center">{t('eyebrow')}</SectionEyebrow>}
          title={t('title')}
          sub={t('lede')}
          titleId="trust-because-tracked-title"
          titleClassName="display text-[var(--fg)] text-balance text-[clamp(28px,5vw,52px)] tracking-tight leading-[1.05] font-semibold"
          subClassName="text-[var(--fg-2)] max-w-[58ch] leading-relaxed text-[15px] sm:text-[16px]"
        />

        <div className="mt-16 flex justify-center">
          <div className="w-full max-w-[560px]">
            <LastPredictionCard variant="feature" />
          </div>
        </div>

        <div className="mt-20 mx-auto max-w-[1000px] flex flex-col gap-6">
          <SectionEyebrow align="center">{t('proofEyebrow')}</SectionEyebrow>
          <ul className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Community proof">
            {PROOF_KEYS.map((key) => (
              <li key={key} className="contents">
                <div className="flex flex-col gap-3">
                  <DataTile
                    variant="terminal"
                    live
                    label={t(`proof.${key}.name`)}
                    value={t(`proof.${key}.value`)}
                    size="lg"
                  />
                  <p className="text-[12px] text-[var(--fg-2)] leading-snug px-1">
                    {t(`proof.${key}.description`)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
