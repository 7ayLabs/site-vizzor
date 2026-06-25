/**
 * SurfaceCompare — three terminal cards (Telegram / CLI / Web) shown
 * side-by-side on desktop, behind a tablist on mobile.
 *
 * Each card is a terminal-shell panel with:
 *   - header  : surface name + `<LiveBadge>`
 *   - body    : faux terminal output (mono lines via <TerminalBlock>)
 *   - footer  : small CTA pill (CtaSecondary)
 *
 * Reuses existing translation keys verbatim (`surfaceCompare.telegram.*`,
 * `surfaceCompare.cli.*`, `surfaceCompare.dashboard.*`), plus
 * `surfaceCompare.dashboard.title` is repurposed as the "Web" tab label.
 *
 * Server component; the tab interaction is isolated in `surface-compare.client`.
 */
import { getTranslations } from 'next-intl/server';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { TypingTerminal } from '@/components/ui/typing-terminal';
import { CtaSecondary } from '@/components/ui/cta-secondary';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { SurfaceCompareTabs } from './surface-compare.client';
import { cn } from '@/lib/utils';

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

const DASHBOARD_CODE = [
  'GET wss://api.vizzor.ai/v1/stream',
  '  ↳ tracked WR  71.2%',
  '  ↳ trending    14 tokens · 4h',
  '  ↳ whale       8 events · 1h',
  '  ↳ polymarket  edge ETH @0.64',
].join('\n');

interface SurfaceCardProps {
  title: string;
  code: string;
  lang: string;
  showPrompt?: boolean;
  cta: React.ReactNode;
  pill?: string;
  /** Per-card typing delay so the three terminals don't all type
   *  simultaneously on first scroll. */
  durationMs?: number;
}

function SurfaceCard({
  title,
  code,
  lang,
  showPrompt,
  cta,
  pill,
  durationMs,
}: SurfaceCardProps) {
  return (
    <div
      className={cn(
        'relative flex flex-col gap-4 h-full',
        'rounded-2xl bg-[var(--surface)] vt-bracket border border-[var(--border)] p-5',
      )}
    >
      <div className="flex items-baseline gap-2 min-w-0">
        <h3 className="text-[15px] font-semibold tracking-tight text-[var(--fg)] truncate">
          {title}
        </h3>
        {pill && (
          <span className="mono tabular text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-3)] leading-none">
            · {pill}
          </span>
        )}
      </div>

      <TypingTerminal
        code={code}
        lang={lang}
        showPrompt={showPrompt}
        durationMs={durationMs}
      />

      <div className="mt-auto pt-1">{cta}</div>
    </div>
  );
}

export async function SurfaceCompare() {
  const t = await getTranslations('surfaceCompare');

  const telegramPanel = (
    <SurfaceCard
      title={t('telegram.title')}
      pill={t('telegram.pill')}
      code={TELEGRAM_CODE}
      lang="telegram"
      durationMs={1600}
      cta={
        <CtaSecondary
          href="https://t.me/vizzorai_bot"
          external
          size="sm"
        >
          {t('telegram.cta')}
        </CtaSecondary>
      }
    />
  );

  const cliPanel = (
    <SurfaceCard
      title={t('cli.title')}
      code={CLI_CODE}
      lang="shell"
      showPrompt={false}
      durationMs={1700}
      cta={
        <CtaSecondary href="/docs/cli" size="sm">
          {t('cli.cta')}
        </CtaSecondary>
      }
    />
  );

  const dashboardPanel = (
    <SurfaceCard
      title={t('dashboard.title')}
      code={DASHBOARD_CODE}
      lang={t('dashboard.mockup.chrome')}
      showPrompt={false}
      durationMs={1900}
      cta={
        <CtaSecondary href="/docs" size="sm">
          {t('dashboard.cta')}
        </CtaSecondary>
      }
    />
  );

  return (
    <section
      aria-labelledby="surface-compare-title"
      className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-24 lg:py-32"
    >
      <GsapHeadline
        className="flex flex-col gap-4 max-w-[58ch]"
        eyebrow={<SectionEyebrow>{t('eyebrow')}</SectionEyebrow>}
        title={t('title')}
        sub={t('lede')}
        titleId="surface-compare-title"
        titleClassName="display text-[var(--fg)] text-balance text-[28px] sm:text-[36px] lg:text-[44px] leading-[1.05] tracking-[-0.02em] font-semibold"
        subClassName="text-[var(--fg-2)] leading-relaxed max-w-[58ch] text-[15px] sm:text-[16px]"
      />

      <div className="mt-20">
        <SurfaceCompareTabs
          tabs={[
            {
              id: 'telegram',
              label: t('telegram.title'),
              panel: telegramPanel,
            },
            { id: 'cli', label: t('cli.title'), panel: cliPanel },
            {
              id: 'dashboard',
              label: t('dashboard.title'),
              panel: dashboardPanel,
            },
          ]}
        />
      </div>
    </section>
  );
}
