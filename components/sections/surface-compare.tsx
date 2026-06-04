/**
 * SurfaceCompare — three alternating two-column rows.
 *
 * Ollama "Automate your work" pattern: each row pairs a copy column (small
 * eyebrow + h3 + lede + 3 check bullets + secondary CTA) with a mock column
 * (terminal block or simple dashboard frame). Rows alternate sides for
 * vertical rhythm: copy-left → mock-left → copy-left. No card surfaces, no
 * heavy borders — whitespace separates the bands.
 *
 * Reuses existing surfaceCompare.* translation keys verbatim (telegram.title,
 * telegram.sub, telegram.features.*, etc.) so we never touch the message
 * files. The "recommended" eyebrow tints accent; the others sit on fg-3.
 *
 * Server component: `TerminalBlock` and `MotionReveal` are independent
 * client islands inside this server tree.
 */
import { getTranslations } from 'next-intl/server';
import { Check } from 'lucide-react';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { TerminalBlock } from '@/components/ui/terminal-block';
import { CtaSecondary } from '@/components/ui/cta-secondary';
import { MotionReveal } from '@/components/ui/motion-reveal';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { cn } from '@/lib/utils';

interface CopyColumnProps {
  eyebrow: string;
  eyebrowAccent?: boolean;
  title: string;
  desc: string;
  bullets: readonly string[];
  cta: React.ReactNode;
}

function CopyColumn({
  eyebrow,
  eyebrowAccent = false,
  title,
  desc,
  bullets,
  cta,
}: CopyColumnProps) {
  return (
    <div className="flex flex-col gap-4 max-w-[480px]">
      <span
        className={cn(
          'text-[11px] font-semibold uppercase tracking-[0.18em]',
          eyebrowAccent ? 'text-[var(--accent)]' : 'text-[var(--fg-3)]',
        )}
      >
        {eyebrow}
      </span>
      <h3 className="text-3xl font-bold tracking-tight text-[var(--fg)]">
        {title}
      </h3>
      <p className="text-[var(--fg-2)] leading-relaxed">{desc}</p>
      <ul className="mt-2 space-y-2.5">
        {bullets.map((bullet) => (
          <li
            key={bullet}
            className="flex items-start gap-2.5 text-[14px] text-[var(--fg-2)]"
          >
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center text-[var(--fg-3)]"
            >
              <Check size={14} strokeWidth={2} />
            </span>
            <span className="leading-relaxed">{bullet}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4">{cta}</div>
    </div>
  );
}

const TELEGRAM_CODE = [
  '/predict ETH 4h',
  '/diagnose BTC',
  '/wr ETH 1h',
  '/sub HYPE',
  '/alert ETH $2200',
].join('\n');

const CLI_CODE = [
  '$ npm i -g @vizzor/cli',
  '$ vizzor predict BTC 4h',
  '$ vizzor scan 0xA0b8... --chain ethereum',
  "$ vizzor trends --json | jq '.tokens[0]'",
].join('\n');

interface DashboardFrameProps {
  chromeLabel: string;
  tiles: ReadonlyArray<{ label: string; value: string; hint?: string }>;
}

function DashboardFrame({ chromeLabel, tiles }: DashboardFrameProps) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
      {/* Subtle, monochrome window chrome — no traffic-light colors. */}
      <div className="flex items-center gap-2 pb-3">
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[var(--border)]" />
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[var(--border)]" />
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[var(--border)]" />
        <span className="mono ml-2 text-[10px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
          {chromeLabel}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-3 flex flex-col gap-1"
          >
            <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
              {tile.label}
            </span>
            <span className="mono tabular text-base font-bold text-[var(--fg)]">
              {tile.value}
            </span>
            {tile.hint && (
              <span className="mono text-[10px] text-[var(--fg-3)]">
                {tile.hint}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export async function SurfaceCompare() {
  const t = await getTranslations('surfaceCompare');

  const telegramBullets = [
    t('telegram.features.alerts'),
    t('telegram.features.session'),
    t('telegram.features.runtime'),
  ];
  const cliBullets = [
    t('cli.features.offline'),
    t('cli.features.json'),
    t('cli.features.engine'),
  ];
  const dashboardBullets = [
    t('dashboard.features.websocket'),
    t('dashboard.features.polymarket'),
    t('dashboard.features.paperTrading'),
  ];

  const dashboardTiles = [
    {
      label: t('dashboard.mockup.btcSpot'),
      value: '$108,420',
      hint: '+1.2%',
    },
    {
      label: t('dashboard.mockup.trackedWr'),
      value: '71.2%',
      hint: 'n=1,847',
    },
    {
      label: t('dashboard.mockup.trending'),
      value: '14',
      hint: t('dashboard.mockup.trendingHint'),
    },
    {
      label: t('dashboard.mockup.whale'),
      value: '8',
      hint: t('dashboard.mockup.whaleHint'),
    },
  ];

  return (
    <section
      aria-labelledby="surface-compare-title"
      className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-32 lg:py-40"
    >
      <GsapHeadline
        className="flex flex-col gap-4 max-w-[58ch]"
        eyebrow={<SectionEyebrow>{t('eyebrow')}</SectionEyebrow>}
        title={t('title')}
        sub={t('lede')}
        titleId="surface-compare-title"
        titleClassName="text-3xl lg:text-5xl font-bold tracking-tight text-[var(--fg)]"
        subClassName="text-[var(--fg-2)] leading-relaxed max-w-[58ch]"
      />

      <div className="mt-24 space-y-32">
        {/* Row 1 — Telegram (recommended) — copy LEFT, mock RIGHT */}
        <MotionReveal delay={0}>
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <CopyColumn
              eyebrow={t('telegram.pill')}
              eyebrowAccent
              title={t('telegram.title')}
              desc={t('telegram.sub')}
              bullets={telegramBullets}
              cta={
                <CtaSecondary
                  href="https://t.me/vizzorai_bot"
                  external
                  size="md"
                >
                  {t('telegram.cta')}
                </CtaSecondary>
              }
            />
            <div>
              <TerminalBlock code={TELEGRAM_CODE} lang="telegram" />
            </div>
          </div>
        </MotionReveal>

        {/* Row 2 — Command line — mock LEFT, copy RIGHT */}
        <MotionReveal delay={80}>
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <div className="order-2 lg:order-1">
              <TerminalBlock code={CLI_CODE} lang="shell" showPrompt={false} />
            </div>
            <div className="order-1 lg:order-2">
              <CopyColumn
                eyebrow="for developers"
                title={t('cli.title')}
                desc={t('cli.sub')}
                bullets={cliBullets}
                cta={
                  <CtaSecondary href="/docs/cli" size="md">
                    {t('cli.cta')}
                  </CtaSecondary>
                }
              />
            </div>
          </div>
        </MotionReveal>

        {/* Row 3 — Web dashboard — copy LEFT, mock RIGHT */}
        <MotionReveal delay={160}>
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <CopyColumn
              eyebrow="visual"
              title={t('dashboard.title')}
              desc={t('dashboard.sub')}
              bullets={dashboardBullets}
              cta={
                <CtaSecondary href="/docs" size="md">
                  {t('dashboard.cta')}
                </CtaSecondary>
              }
            />
            <DashboardFrame
              chromeLabel={t('dashboard.mockup.chrome')}
              tiles={dashboardTiles}
            />
          </div>
        </MotionReveal>
      </div>
    </section>
  );
}
