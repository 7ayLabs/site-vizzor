/**
 * /dev/components — internal QA page. Renders every atomic component in
 * isolation. Dev-only: returns 404 in production builds so it's never
 * reachable at vizzor.ai/dev/components.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TierBadge } from '@/components/ui/tier-badge';
import { DataTile } from '@/components/ui/data-tile';
import { TerminalBlock } from '@/components/ui/terminal-block';
import { CopyChip } from '@/components/ui/copy-chip';
import { ChainPill } from '@/components/ui/chain-pill';
import { SignalRow } from '@/components/ui/signal-row';
import { WRRing } from '@/components/ui/wr-ring';
import { PredictionCard } from '@/components/ui/prediction-card';
import { CtaPrimary } from '@/components/ui/cta-primary';
import { CtaSecondary } from '@/components/ui/cta-secondary';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { HorizonStripDemo } from './horizon-strip-demo';
import { MotionReveal } from '@/components/ui/motion-reveal';
import { formatUsd } from '@/lib/utils';
import { getRecentPredictions, getTrackerWR } from '@/lib/snapshot';
import type { Chain, SignalContribution, Tier } from '@/lib/types';

export const metadata: Metadata = {
  title: 'Components · Dev',
  robots: { index: false, follow: false },
};

const TIERS: Tier[] = ['high-conviction', 'whale-confirmed', 'tracked', 'advisory'];
const CHAINS: Chain[] = [
  'ethereum',
  'polygon',
  'arbitrum',
  'optimism',
  'base',
  'bsc',
  'avalanche',
  'solana',
  'sui',
  'aptos',
  'ton',
];

const SAMPLE_SIGNALS: SignalContribution[] = [
  { family: 'onChain', cf: 0.62, direction: 'up', meta: { whale_inflow: '$18.4M' } },
  { family: 'mlEnsemble', cf: 0.48, direction: 'up', meta: { rsi14: 58.3 } },
  { family: 'logicRules', cf: 0.55, direction: 'up', meta: { fired: 'sma_accum' } },
  { family: 'predictionMarkets', cf: 0.31, direction: 'up', meta: { implied: 0.64 } },
  { family: 'patternMatch', cf: 0.4, direction: 'up', meta: { pattern: 'BOS_4h' } },
  { family: 'socialNarrative', cf: -0.18, direction: 'down', meta: { sentiment: -0.21 } },
];

export default function ComponentsDevPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  const predictions = getRecentPredictions();
  const wr = getTrackerWR();

  return (
    <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-12 space-y-20">
      <header className="space-y-3 max-w-2xl">
        <SectionEyebrow>internal · component qa</SectionEyebrow>
        <h1 className="display text-[var(--fg)]">Design system</h1>
        <p className="text-[var(--fg-2)] text-base leading-relaxed">
          Every atomic component, both modes. Toggle the theme in the header to verify parity.
        </p>
      </header>

      <Section title="TierBadge">
        <div className="flex flex-wrap items-center gap-3">
          {TIERS.map((t) => (
            <TierBadge key={t} tier={t} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          {TIERS.map((t) => (
            <TierBadge key={`${t}-sm`} tier={t} size="sm" />
          ))}
        </div>
      </Section>

      <Section title="DataTile">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <DataTile label="BTC · 4h" value={formatUsd(108_420)} delta={0.012} direction="up" />
          <DataTile label="ETH · 1d" value={formatUsd(2_156)} delta={0.021} direction="up" />
          <DataTile label="SOL · 4h" value={formatUsd(184.3)} delta={-0.008} direction="down" />
          <DataTile label="Tracked WR" value="71.2%" hint="n=1,847" />
          <DataTile label="🐋 confirmed" value="82.4%" hint="n=312" />
          <DataTile label="🌟 hi-conv" value="78.9%" hint="n=566" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
          <DataTile size="sm" label="Small" value="$1,234" delta={0.024} direction="up" />
          <DataTile size="md" label="Medium" value="$12,340" delta={-0.011} direction="down" />
          <DataTile size="lg" label="Large" value="$123,400" delta={0} direction="flat" hint="last 24h" />
        </div>
      </Section>

      <Section title="TerminalBlock">
        <TerminalBlock
          showPrompt
          code={[
            'predict ETH at 16:00',
            '→ ETH at $2,112 | Bullish | Confidence: Medium-High',
            '  4:00 PM   $2,128 (+0.8%) bull / $2,104 (-0.4%) bear',
            '  1 day     $2,156 (+2.1%) bull / $2,068 (-2.1%) bear',
            '  7 days    $2,295 (+8.7%) bull / $1,985 (-6.0%) bear',
            '▸ 🌟 high-conviction · 🐋 whale-confirmed',
          ].join('\n')}
          highlightLines={[2, 6]}
        />
        <div className="mt-4">
          <TerminalBlock
            code={`npm install -g @vizzor/cli
vizzor setup
vizzor predict BTC 4h`}
          />
        </div>
      </Section>

      <Section title="CopyChip">
        <div className="flex flex-wrap gap-3">
          <CopyChip command="npm i -g @vizzor/cli" />
          <CopyChip command="pnpm dev" />
          <CopyChip command="docker compose up -d" label="run the stack" />
        </div>
      </Section>

      <Section title="ChainPill">
        <div className="flex flex-wrap items-center gap-2">
          {CHAINS.map((c) => (
            <ChainPill key={c} chain={c} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {CHAINS.map((c) => (
            <ChainPill key={`${c}-xs`} chain={c} size="xs" />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {CHAINS.map((c) => (
            <ChainPill key={`${c}-icon`} chain={c} showLabel={false} />
          ))}
        </div>
      </Section>

      <Section title="SignalRow">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-2">
          {SAMPLE_SIGNALS.map((s) => (
            <SignalRow key={s.family} signal={s} />
          ))}
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 mt-4 space-y-1.5">
          {SAMPLE_SIGNALS.map((s) => (
            <SignalRow key={`${s.family}-c`} signal={s} compact />
          ))}
        </div>
      </Section>

      <Section title="WRRing">
        <div className="flex flex-wrap items-end gap-8">
          <WRRing percent={wr.aggregate.wr} samples={wr.aggregate.samples} label="tracked wr" />
          <WRRing percent={wr.byTier['high-conviction'].wr} samples={wr.byTier['high-conviction'].samples} size={110} label="🌟 hi-conv" />
          <WRRing percent={wr.byTier['whale-confirmed'].wr} samples={wr.byTier['whale-confirmed'].samples} size={110} label="🐋 confirmed" />
          <WRRing percent={0.42} samples={28} size={80} label="below floor" />
        </div>
      </Section>

      <Section title="PredictionCard">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {predictions.slice(0, 4).map((p) => (
            <PredictionCard key={p.id} prediction={p} />
          ))}
        </div>
        <div className="mt-6">
          {predictions[0] && <PredictionCard prediction={predictions[0]} expanded />}
        </div>
      </Section>

      <Section title="CTA buttons">
        <div className="flex flex-wrap items-center gap-3">
          <CtaPrimary href="https://t.me/VizzorBot" external>Open in Telegram</CtaPrimary>
          <CtaSecondary href="https://github.com/7ayLabs/vizzor" external>Read on GitHub</CtaSecondary>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <CtaPrimary href="https://t.me/VizzorBot" external size="sm">$ npm i -g @vizzor/cli</CtaPrimary>
          <CtaPrimary href="https://t.me/VizzorBot" external size="md">Get Vizzor</CtaPrimary>
          <CtaPrimary href="https://t.me/VizzorBot" external size="lg">See predictions</CtaPrimary>
        </div>
      </Section>

      <Section title="SectionEyebrow">
        <div className="space-y-4">
          <SectionEyebrow>live · tracked wr 71.2% · n=1,847</SectionEyebrow>
          <SectionEyebrow align="center">receipts, not promises</SectionEyebrow>
        </div>
      </Section>

      <Section title="HorizonStrip">
        <HorizonStripDemo />
      </Section>

      <Section title="MotionReveal">
        <p className="text-[var(--fg-2)] mb-4">Scroll-reveal — each row staggered by 80ms.</p>
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <MotionReveal key={i} delay={i * 80}>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[var(--fg-2)]">
                Row {i + 1} — revealed with 200ms ease-out + 8px translate
              </div>
            </MotionReveal>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between border-b border-[var(--border)] pb-2">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--fg)]">{title}</h2>
        <span className="eyebrow text-[var(--fg-3)]">component</span>
      </div>
      {children}
    </section>
  );
}
