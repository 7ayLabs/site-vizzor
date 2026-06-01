/**
 * /pricing — transparency page.
 *
 * Vizzor is free. The page exists so the cost model is visible: what we don't
 * charge for, what the operator brings, what 7ayLabs pays. Three side-by-side
 * blocks → a four-tile cost-row strip → a long-form philosophy block → a
 * self-host CTA row.
 *
 * Server component: pure render. All numbers are anchored to honest values;
 * if they drift we'll update the keys in messages/*.json, not the markup.
 */

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Check, Gift, Key, Server } from 'lucide-react';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { CtaPrimary } from '@/components/ui/cta-primary';
import { CtaSecondary } from '@/components/ui/cta-secondary';
import { CopyChip } from '@/components/ui/copy-chip';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { MotionReveal } from '@/components/ui/motion-reveal';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { cn } from '@/lib/utils';

interface BlockProps {
  icon: React.ReactNode;
  title: string;
  items: ReadonlyArray<string>;
  accent: string;
}

function Block({ icon, title, items, accent }: BlockProps) {
  return (
    <div className="flex h-full flex-col gap-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="inline-flex h-9 w-9 items-center justify-center rounded-full"
          style={{ background: `color-mix(in oklab, ${accent} 14%, transparent)`, color: accent }}
        >
          {icon}
        </span>
        <h3 className="text-lg font-semibold tracking-tight text-[var(--fg)]">
          {title}
        </h3>
      </div>

      <ul className="flex flex-col gap-2.5">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start gap-2.5 text-[14px] leading-relaxed text-[var(--fg-2)]">
            <Check
              size={14}
              strokeWidth={2}
              className="mt-1 shrink-0"
              style={{ color: accent }}
              aria-hidden
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface CostTile {
  label: string;
  value: number;
  format: 'usd' | 'int';
  decimals?: number;
  hint: string;
}

function CostTileCard({ tile }: { tile: CostTile }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition-transform duration-100 ease-out hover:-translate-y-px">
      <div className="text-[11px] font-semibold uppercase leading-none tracking-[0.16em] text-[var(--fg-3)]">
        {tile.label}
      </div>
      <div className="mono tabular text-xl font-bold leading-none text-[var(--fg)] sm:text-2xl">
        <AnimatedNumber
          value={tile.value}
          format={tile.format}
          decimals={tile.decimals}
        />
      </div>
      <div className="text-[10px] leading-tight text-[var(--fg-3)]">
        {tile.hint}
      </div>
    </div>
  );
}

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pricing');

  const block1Items: ReadonlyArray<string> = [
    t('block1.items.cli'),
    t('block1.items.bot'),
    t('block1.items.discord'),
    t('block1.items.dashboard'),
    t('block1.items.predictions'),
    t('block1.items.docs'),
  ];

  const block2Items: ReadonlyArray<string> = [
    t('block2.items.llmKey'),
    t('block2.items.rpcKey'),
    t('block2.items.dataKey'),
    t('block2.items.botTokens'),
    t('block2.items.host'),
  ];

  const block3Items: ReadonlyArray<string> = [
    t('block3.items.telegram'),
    t('block3.items.chronovisor'),
    t('block3.items.sharedLlm'),
    t('block3.items.domain'),
  ];

  const costTiles: ReadonlyArray<CostTile> = [
    {
      label: t('costRow.dailyCost.label'),
      value: 0.018,
      format: 'usd',
      decimals: 3,
      hint: t('costRow.dailyCost.hint'),
    },
    {
      label: t('costRow.dailyQuota.label'),
      value: 25,
      format: 'int',
      hint: t('costRow.dailyQuota.hint'),
    },
    {
      label: t('costRow.hostedUsers.label'),
      value: 1247,
      format: 'int',
      hint: t('costRow.hostedUsers.hint', {
        date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
          new Date('2026-05-31T00:00:00Z'),
        ),
      }),
    },
    {
      label: t('costRow.selfHosted.label'),
      value: 83,
      format: 'int',
      hint: t('costRow.selfHosted.hint'),
    },
  ];

  // The philosophy block is one rich string with paragraphs separated by \n\n.
  const philosophyParas = t('philosophy').split(/\n\n+/).filter(Boolean);

  return (
    <section className="relative">
      <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-16 lg:py-32">
        <GsapHeadline
          as="h1"
          className="flex max-w-[42ch] flex-col gap-4"
          eyebrow={<SectionEyebrow>{t('pricingEyebrow')}</SectionEyebrow>}
          title={t('pricingTitle')}
          sub={t('pricingSub')}
          titleClassName="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-[var(--fg)]"
          subClassName="mt-4 text-[var(--fg-2)] leading-relaxed max-w-[64ch]"
        />

        {/* Three blocks */}
        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <MotionReveal delay={0}>
            <Block
              icon={<Gift size={16} strokeWidth={1.75} aria-hidden />}
              title={t('block1.title')}
              items={block1Items}
              accent="var(--accent)"
            />
          </MotionReveal>
          <MotionReveal delay={80}>
            <Block
              icon={<Key size={16} strokeWidth={1.75} aria-hidden />}
              title={t('block2.title')}
              items={block2Items}
              accent="var(--whale)"
            />
          </MotionReveal>
          <MotionReveal delay={160}>
            <Block
              icon={<Server size={16} strokeWidth={1.75} aria-hidden />}
              title={t('block3.title')}
              items={block3Items}
              accent="var(--gold)"
            />
          </MotionReveal>
        </div>

        {/* Cost row */}
        <MotionReveal delay={120}>
          <div className="mt-12 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-6 sm:p-8">
            <SectionEyebrow>{t('costRow.eyebrow')}</SectionEyebrow>

            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {costTiles.map((tile) => (
                <CostTileCard key={tile.label} tile={tile} />
              ))}
            </div>
          </div>
        </MotionReveal>

        {/* Philosophy long-form */}
        <MotionReveal delay={80}>
          <div className="mx-auto mt-16 flex max-w-[58ch] flex-col gap-5">
            {philosophyParas.map((para, idx) => (
              <p
                key={idx}
                className="text-[15px] leading-[1.7] text-[var(--fg)]"
              >
                {para}
              </p>
            ))}
          </div>
        </MotionReveal>

        {/* Self-host CTA row */}
        <MotionReveal delay={120}>
          <div className="mt-16 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 sm:p-10">
            <div className="flex flex-col items-start gap-5">
              <div className="flex flex-col gap-2">
                <h3 className="text-2xl font-bold tracking-tight text-[var(--fg)]">
                  {t('cta.title')}
                </h3>
                <p className="max-w-[58ch] leading-relaxed text-[var(--fg-2)]">
                  {t('cta.sub')}
                </p>
              </div>
              <div className={cn('flex flex-wrap items-center gap-3')}>
                <CtaPrimary href="/docs/quickstart">
                  {t('cta.quickstart')}
                </CtaPrimary>
                <CtaSecondary href="https://github.com/7ayLabs/vizzor" external>
                  {t('cta.github')}
                </CtaSecondary>
                <CopyChip command="docker compose up -d" />
              </div>
            </div>
          </div>
        </MotionReveal>
      </div>
    </section>
  );
}
