/**
 * WhatsInIt — "One call. Full receipts." as a three-panel terminal cockpit.
 *
 * Server component. The section becomes a 12-col grid of three big
 * `<DataTile variant="terminal" live />` panels under a scanline tint:
 *
 *   - Direction   : an oversized ▲/▼ glyph + calibrated probability
 *   - Confidence  : Platt-calibrated horizontal bar with 0/25/50/75/100 ticks
 *   - Alerts      : faux event feed (3 mono rows) headed by a <LiveBadge>
 *
 * The headline column (eyebrow + title + lede + 3 bullets + see-the-math
 * link) lives above the panels at full width — copy first, instruments
 * second, mirroring the existing key set in messages/en.json:
 *   whatsInIt.{eyebrow,title,sub,bullets.{directional,targets,snapshot},
 *              learnMore}
 *
 * No new translation keys introduced. Static labels inside the panels
 * (e.g. "DIRECTION", "CONFIDENCE", "ALERTS") are intentionally rendered
 * in the existing terminal aesthetic — they are not user-facing prose,
 * just instrument labels (uppercase mono micro-labels). Phase 2C can
 * promote them to i18n if desired without changing component shape.
 */
import { getTranslations } from 'next-intl/server';
import { Check } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { DataTile } from '@/components/ui/data-tile';
import { cn } from '@/lib/utils';

const CONFIDENCE_PCT = 78; // matches the long-standing copy example
const CONFIDENCE_TICKS: readonly number[] = [0, 25, 50, 75, 100];

interface AlertRow {
  marker: string;
  label: string;
  hint: string;
}

const ALERT_ROWS: readonly AlertRow[] = [
  { marker: '●', label: 'TP1 · $2,156', hint: 'armed' },
  { marker: '●', label: 'TP2 · $2,174', hint: 'armed' },
  { marker: '○', label: 'SL  · $2,098', hint: 'idle' },
];

export async function WhatsInIt() {
  const t = await getTranslations('whatsInIt');

  return (
    <section className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-20 md:py-28 lg:py-32">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12">
        {/* Headline + bullets — copy band */}
        <div className="lg:col-span-7">
          <GsapHeadline
            eyebrow={
              <span className="mono tabular text-[11px] tracking-[0.22em] uppercase text-[var(--fg-3)]">
                {t('eyebrow')}
              </span>
            }
            title={t('title')}
            sub={t('sub')}
            titleClassName="display text-[var(--fg)] text-balance text-[28px] sm:text-[36px] lg:text-[44px] leading-[1.05] tracking-[-0.02em] font-semibold mt-4"
            subClassName="mt-5 text-[15px] sm:text-[16px] leading-relaxed text-[var(--fg-2)] max-w-[52ch]"
          />
        </div>

        <ul className="lg:col-span-5 flex flex-col gap-2.5 self-end">
          {(['directional', 'targets', 'snapshot'] as const).map((k) => (
            <li
              key={k}
              className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
            >
              <Check
                size={16}
                strokeWidth={2}
                className="mt-[3px] flex-none text-[var(--fg)]"
                aria-hidden
              />
              <span className="text-[13.5px] text-[var(--fg)] leading-relaxed">
                {t(`bullets.${k}`)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Instrument panels — 12-col grid, stack on mobile */}
      <div className="mt-12 grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Direction */}
        <div className="md:col-span-4">
          <DataTile
            variant="terminal"
            size="lg"
            label="direction"
            value="↑ UP"
            hint="entry $2,112.40"
          />
        </div>

        {/* Confidence */}
        <div className="md:col-span-5">
          <ConfidenceTile
            percent={CONFIDENCE_PCT}
            ticks={CONFIDENCE_TICKS}
          />
        </div>

        {/* Alerts feed */}
        <div className="md:col-span-3">
          <AlertsTile rows={ALERT_ROWS} />
        </div>
      </div>

      <div className="mt-8">
        <Link
          href="/docs/chronovisor"
          className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-[var(--fg)] underline-offset-4 hover:underline"
        >
          <span>{t('learnMore')}</span>
          <span aria-hidden>→</span>
        </Link>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- *
 * Local terminal-shell tiles (pure server-renderable; no event hooks)
 * ---------------------------------------------------------------- */

interface ConfidenceTileProps {
  percent: number;
  ticks: readonly number[];
}

function ConfidenceTile({ percent, ticks }: ConfidenceTileProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      className={cn(
        'relative flex flex-col gap-4 h-full',
        'rounded-lg bg-[var(--surface)] vt-bracket border border-[var(--border)] p-6',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--fg-3)] leading-none">
          confidence
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="mono tabular text-3xl sm:text-4xl font-bold leading-none text-[var(--fg)]">
          {clamped}
        </span>
        <span className="mono tabular text-base text-[var(--fg-2)] leading-none">
          / 100
        </span>
      </div>

      <div
        className="relative h-2 rounded-full overflow-hidden bg-[var(--surface-2)]"
        role="meter"
        aria-label="Confidence"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full bg-[var(--accent)]"
          style={{ width: `${clamped}%` }}
        />
      </div>

      <div
        className="flex justify-between mono tabular text-[10px] text-[var(--fg-3)] leading-none"
        aria-hidden
      >
        {ticks.map((tick) => (
          <span key={tick}>{tick}</span>
        ))}
      </div>
    </div>
  );
}

interface AlertsTileProps {
  rows: readonly AlertRow[];
}

function AlertsTile({ rows }: AlertsTileProps) {
  return (
    <div
      className={cn(
        'relative flex flex-col gap-3 h-full',
        'rounded-lg bg-[var(--surface)] vt-bracket border border-[var(--border)] p-6',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--fg-3)] leading-none">
          alerts
        </span>
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const armed = row.hint === 'armed';
          return (
            <li
              key={row.label}
              className="flex items-center justify-between gap-3 mono tabular text-[12px]"
            >
              <span className="inline-flex items-center gap-2 truncate">
                <span
                  aria-hidden
                  className={cn(
                    armed ? 'text-[var(--accent)]' : 'text-[var(--fg-3)]',
                  )}
                >
                  [{row.marker}]
                </span>
                <span className="text-[var(--fg)] truncate">{row.label}</span>
              </span>
              <span
                className={cn(
                  'uppercase tracking-[0.14em] text-[10px] shrink-0',
                  armed ? 'text-[var(--accent)]' : 'text-[var(--fg-3)]',
                )}
              >
                {row.hint}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
