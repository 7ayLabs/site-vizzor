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
import { TerminalBlock } from '@/components/ui/terminal-block';
import { CtaSecondary } from '@/components/ui/cta-secondary';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { LiveBadge } from '@/components/ui/live-badge';
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
  badgeTone: 'mint' | 'gold' | 'whale';
  code: string;
  lang: string;
  showPrompt?: boolean;
  cta: React.ReactNode;
  pill?: string;
}

function SurfaceCard({
  title,
  badgeTone,
  code,
  lang,
  showPrompt,
  cta,
  pill,
}: SurfaceCardProps) {
  return (
    <div
      className={cn(
        'relative flex flex-col gap-4 h-full',
        'rounded-lg bg-[var(--surface)] vt-bracket border border-[var(--border-hi)] p-5',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight text-[var(--fg)] truncate">
            {title}
          </h3>
          {pill && (
            <span className="mono tabular text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)] leading-none">
              · {pill}
            </span>
          )}
        </div>
        <LiveBadge tone={badgeTone} />
      </div>

      <TerminalBlock code={code} lang={lang} showPrompt={showPrompt} />

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
      badgeTone="mint"
      code={TELEGRAM_CODE}
      lang="telegram"
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
      badgeTone="gold"
      code={CLI_CODE}
      lang="shell"
      showPrompt={false}
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
      badgeTone="whale"
      code={DASHBOARD_CODE}
      lang={t('dashboard.mockup.chrome')}
      showPrompt={false}
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
