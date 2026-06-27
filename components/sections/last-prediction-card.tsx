'use client';

/**
 * LastPredictionCard — single most-recent confirmed prediction rendered
 * as a self-contained terminal-style card.
 *
 * Designed as the WR-ring replacement across the marketing surface (hero
 * data stack + TrustBecauseTracked centrepiece). Factored once so both
 * surfaces share the exact same data binding, copy, and a11y contract.
 *
 * Data source: live `useRecentPredictions` (SWR) — picks the first row
 * with a resolved `outcome` (hit / miss / neutral). Falls back to the
 * most recent pending row if nothing has resolved yet, so the card is
 * always populated. Snapshot fallback is automatic because the hook
 * itself falls back; visitors never see "no data."
 *
 * a11y contract:
 *   - The outcome chip carries the outcome WORD ("HIT" / "MISS"), not
 *     just a color — colorblind-safe by design.
 *   - The card root is a real `<article>` with an aria-labelledby pointer
 *     to the title.
 *   - The relative timestamp is wrapped in a <time dateTime> for
 *     assistive tech / parsers.
 *
 * Animation respects prefers-reduced-motion via the existing global
 * `motion-safe:` Tailwind variant and the `AnimatedNumber` primitive's
 * own reduced-motion check.
 */

import { useId, useMemo } from 'react';
import { useRecentPredictions } from '@/lib/api';
import { CoinIcon } from '@/components/ui/coin-icon';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/utils';
import type { Direction, Outcome, Prediction } from '@/lib/types';

type OutcomeStatus = 'hit' | 'miss' | 'neutral' | 'pending';

export interface LastPredictionCardProps {
  /** Visual variant. `compact` is sized for the hero data stack; `feature`
   *  is the centerpiece treatment used in TrustBecauseTracked (wider,
   *  larger type, scoped spotlight backdrop). */
  variant?: 'compact' | 'feature';
  /** Optional className override for the outer wrapper — variant-aware
   *  positioning lives outside this component. */
  className?: string;
}

/* ─────────────────────────── helpers ─────────────────────────── */

function outcomeStatus(outcome: Outcome | undefined): OutcomeStatus {
  if (outcome === 'hit') return 'hit';
  if (outcome === 'miss') return 'miss';
  if (outcome === 'neutral') return 'neutral';
  return 'pending';
}

function pickShowcase(predictions: ReadonlyArray<Prediction>): Prediction | null {
  if (predictions.length === 0) return null;
  // Prefer the freshest resolved row so the chip carries a real verdict.
  const resolved = predictions.find(
    (p) => p.outcome === 'hit' || p.outcome === 'miss',
  );
  return resolved ?? predictions[0] ?? null;
}

function directionGlyph(direction: Direction): { glyph: string; word: string } {
  if (direction === 'up') return { glyph: '↑', word: 'LONG' };
  if (direction === 'down') return { glyph: '↓', word: 'SHORT' };
  return { glyph: '→', word: 'FLAT' };
}

function directionColor(direction: Direction): string {
  if (direction === 'up') return 'var(--up)';
  if (direction === 'down') return 'var(--down)';
  return 'var(--fg-2)';
}

/* ─────────────────────────── outcome chip ─────────────────────────── */

interface OutcomeChipProps {
  status: OutcomeStatus;
  size: 'sm' | 'md';
}

function OutcomeChip({ status, size }: OutcomeChipProps) {
  const baseClass =
    'mono tabular inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-semibold uppercase tracking-[0.16em]';
  const sizeClass = size === 'sm' ? 'text-[9.5px]' : 'text-[10.5px] px-3 py-1';

  if (status === 'hit') {
    return (
      <span
        className={cn(baseClass, sizeClass, 'border-[var(--border-hi)]')}
        style={{ color: 'var(--up)' }}
      >
        <span aria-hidden>✓</span>
        <span>HIT</span>
      </span>
    );
  }
  if (status === 'miss') {
    return (
      <span
        className={cn(baseClass, sizeClass, 'border-[var(--border-hi)]')}
        style={{ color: 'var(--down)' }}
      >
        <span aria-hidden>✗</span>
        <span>MISS</span>
      </span>
    );
  }
  if (status === 'neutral') {
    return (
      <span
        className={cn(
          baseClass,
          sizeClass,
          'border-[var(--border)] text-[var(--fg-2)]',
        )}
      >
        <span aria-hidden>◌</span>
        <span>NEUTRAL</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        baseClass,
        sizeClass,
        'border-[var(--border)] text-[var(--fg-3)]',
      )}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full bg-[var(--fg-3)] motion-safe:animate-pulse"
      />
      <span>PENDING</span>
    </span>
  );
}

/* ─────────────────────────── card ─────────────────────────── */

export function LastPredictionCard({
  variant = 'compact',
  className,
}: LastPredictionCardProps) {
  const recents = useRecentPredictions({ limit: 8 });
  const titleId = useId();
  const showcase = useMemo(() => pickShowcase(recents.data), [recents.data]);

  if (!showcase) {
    return null;
  }

  const status = outcomeStatus(showcase.outcome);
  const dir = directionGlyph(showcase.direction);
  const dirColor = directionColor(showcase.direction);
  const confidencePct = Math.round(showcase.confidence * 100);
  const timestampIso = showcase.resolvedAt ?? showcase.emittedAt;
  const rel = relativeTime(timestampIso);
  const isFeature = variant === 'feature';

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        'group relative',
        'border border-[var(--border)] bg-[var(--surface)]',
        'rounded-2xl overflow-hidden',
        'shadow-[0_24px_60px_-28px_rgba(0,0,0,0.35)]',
        'dark:shadow-[0_24px_60px_-22px_rgba(0,0,0,0.7)]',
        'transition-[border-color,box-shadow] duration-300 ease-out',
        'hover:border-[var(--border-hi)]',
        'hover:shadow-[0_28px_72px_-24px_rgba(0,0,0,0.45)]',
        'dark:hover:shadow-[0_28px_72px_-18px_rgba(0,0,0,0.85)]',
        'vt-bracket',
        className,
      )}
    >
      <span aria-hidden className="vt-scanlines absolute inset-0 rounded-2xl" />

      <div
        className={cn(
          'relative flex flex-col gap-4',
          isFeature ? 'p-6 sm:p-8' : 'p-5',
        )}
      >
        {/* ── Header row: eyebrow + outcome chip ────────────────────── */}
        <header className="flex items-center justify-between gap-3">
          <span
            className={cn(
              'mono tabular uppercase font-semibold text-[var(--fg-3)]',
              isFeature
                ? 'text-[11px] tracking-[0.22em]'
                : 'text-[10px] tracking-[0.18em]',
            )}
          >
            Last prediction
          </span>
          <OutcomeChip status={status} size={isFeature ? 'md' : 'sm'} />
        </header>

        {/* ── Body row: asset + direction + confidence ─────────────── */}
        <div className="flex items-center gap-4">
          <CoinIcon
            symbol={showcase.symbol}
            size={isFeature ? 44 : 36}
          />
          <div className="flex flex-col min-w-0">
            <h3
              id={titleId}
              className={cn(
                'display font-semibold text-[var(--fg)] leading-none tracking-tight',
                isFeature ? 'text-[28px] sm:text-[32px]' : 'text-[22px]',
              )}
            >
              {showcase.symbol}
            </h3>
            <span
              className={cn(
                'mono tabular text-[var(--fg-3)] mt-1.5 uppercase tracking-[0.14em]',
                isFeature ? 'text-[10.5px]' : 'text-[10px]',
              )}
            >
              {showcase.horizon} horizon
            </span>
          </div>

          <div
            className="flex items-baseline gap-1.5 ml-auto"
            style={{ color: dirColor }}
          >
            <span
              aria-hidden
              className={cn(
                'mono font-bold leading-none',
                isFeature ? 'text-[40px]' : 'text-[32px]',
              )}
            >
              {dir.glyph}
            </span>
            <span
              className={cn(
                'mono tabular font-bold uppercase tracking-[0.14em]',
                isFeature ? 'text-[14px]' : 'text-[12px]',
              )}
            >
              {dir.word}
            </span>
          </div>
        </div>

        {/* ── Footer row: confidence + timestamp ───────────────────── */}
        <footer
          className={cn(
            'flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3',
            'mono tabular text-[var(--fg-2)]',
            isFeature ? 'text-[12px]' : 'text-[11px]',
          )}
        >
          <span className="inline-flex items-baseline gap-1.5">
            <span className="uppercase tracking-[0.18em] text-[var(--fg-3)]">
              Conf
            </span>
            <span className="font-semibold text-[var(--fg)]">
              {confidencePct}%
            </span>
          </span>
          <time
            dateTime={timestampIso}
            className="text-[var(--fg-3)]"
            title={new Date(timestampIso).toISOString()}
          >
            {rel}
          </time>
        </footer>
      </div>
    </article>
  );
}
