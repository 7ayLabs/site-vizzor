/**
 * TrustBecauseTracked — "Real receipts. Real traders." (Pass 2)
 *
 * The original section listed four conviction tiers (engine internals).
 * Per user feedback ("remove no-vibes scoring; pivot to marketing/Web3"),
 * the section now leads with the public scoreboard ring and supports it
 * with four community-proof DataTiles (traders / calls logged / chains /
 * hidden).
 *
 *   - Center stage : `<WRRing variant="neon" size={280}>` labelled
 *                    "public scoreboard"
 *   - Below        : four `<DataTile variant="terminal" live>` proof tiles
 *   - Behind       : `<RibbonHeat>` at ~20% opacity
 *   - Tint         : `<ScanlineOverlay opacity={0.5}>`
 *
 * Translation keys consumed:
 *   trustBecauseTracked.{eyebrow,title,lede,ringLabel,ringCaption,
 *                        proofEyebrow,proof.<key>.{name,value,description}}
 */
import { getTranslations } from 'next-intl/server';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { WRRing } from '@/components/ui/wr-ring';
import { DataTile } from '@/components/ui/data-tile';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { ScanlineOverlay } from '@/components/ui/scanline-overlay';
import { getTrackerWR } from '@/lib/snapshot';
import { TrustRibbonBackground } from './trust-because-tracked.client';

const PROOF_KEYS = ['traders', 'calls', 'chains', 'hidden'] as const;

export async function TrustBecauseTracked() {
  const t = await getTranslations('trustBecauseTracked');
  const wr = getTrackerWR();

  return (
    <section
      aria-labelledby="trust-because-tracked-title"
      className="relative isolate overflow-hidden"
    >
      <TrustRibbonBackground wr={wr.aggregate.wr} height={400} />
      <ScanlineOverlay opacity={0.5} />

      <div className="relative z-10 mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-32 lg:py-40">
        <GsapHeadline
          glitch
          className="flex flex-col items-center gap-3 max-w-[60ch] mx-auto text-center"
          eyebrow={<SectionEyebrow align="center">{t('eyebrow')}</SectionEyebrow>}
          title={t('title')}
          sub={t('lede')}
          titleId="trust-because-tracked-title"
          titleClassName="text-3xl lg:text-5xl font-bold tracking-tight text-[var(--fg)]"
          subClassName="text-[var(--fg-2)] max-w-[58ch] leading-relaxed"
        />

        <div className="mt-16 flex flex-col items-center gap-4">
          <WRRing
            variant="neon"
            percent={wr.aggregate.wr}
            samples={wr.aggregate.samples}
            size={280}
            label={t('ringLabel')}
          />
          <p className="mono tabular text-[11px] text-[var(--fg-3)] text-center">
            {t('ringCaption')}
          </p>
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
