/**
 * PredictionCard — the canonical surface for a Vizzor chronovisor prediction.
 * Optimized for dense list views but also legible as a single hero card.
 * Composes ChainPill, TierBadge, DataTile, SignalRow so the receipts (signal
 * contributions) can be revealed inline via `expanded` without a separate
 * detail page round-trip.
 *
 * Surface is intentionally quiet: a single border + the canonical surface
 * color, no gradient flourish. Outcome chips in the footer carry the only
 * color the eye should land on after the price.
 */

import { ArrowUpRight, ArrowDownRight, ArrowRight } from 'lucide-react';
import { cn, formatUsd, relativeTime } from '@/lib/utils';
import type { Direction, Outcome, Prediction } from '@/lib/types';
import { ChainPill } from './chain-pill';
import { TierBadge } from './tier-badge';
import { DataTile } from './data-tile';
import { SignalRow } from './signal-row';

export interface PredictionCardProps {
  prediction: Prediction;
  expanded?: boolean;
  dense?: boolean;
}

function DirectionArrow({ direction }: { direction: Direction }) {
  if (direction === 'up') {
    return (
      <ArrowUpRight
        size={20}
        strokeWidth={1.5}
        style={{ color: 'var(--accent)' }}
        aria-label="Predicted up"
      />
    );
  }
  if (direction === 'down') {
    return (
      <ArrowDownRight
        size={20}
        strokeWidth={1.5}
        style={{ color: 'var(--danger)' }}
        aria-label="Predicted down"
      />
    );
  }
  return (
    <ArrowRight
      size={20}
      strokeWidth={1.5}
      style={{ color: 'var(--fg-3)' }}
      aria-label="Predicted sideways"
    />
  );
}

function HorizonChip({ horizon }: { horizon: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center rounded-full px-2',
        'border border-[var(--border)] bg-[var(--surface-2)]',
        'mono tabular text-[10px] font-medium text-[var(--fg-2)]',
      )}
    >
      {horizon}
    </span>
  );
}

interface OutcomeChipConfig {
  glyph: string;
  text: string;
  color: string;
}

const OUTCOME_CONFIG: Record<Outcome, OutcomeChipConfig> = {
  hit: { glyph: '✓', text: 'HIT', color: 'var(--accent)' },
  miss: { glyph: '✗', text: 'MISS', color: 'var(--danger)' },
  neutral: { glyph: '◆', text: 'NEUTRAL', color: 'var(--gold)' },
  pending: { glyph: '·', text: 'PENDING', color: 'var(--fg-3)' },
};

function OutcomeChip({ outcome }: { outcome: Outcome }) {
  const cfg = OUTCOME_CONFIG[outcome];
  return (
    <span
      className="inline-flex items-center gap-1.5 mono text-[11px] font-semibold tracking-[0.06em]"
      style={{ color: cfg.color }}
    >
      <span aria-hidden>{cfg.glyph}</span>
      {cfg.text}
    </span>
  );
}

function deltaFromEntry(target: number, entry: number): number {
  if (entry === 0) return 0;
  return (target - entry) / entry;
}

function targetDirection(delta: number): 'up' | 'down' | 'flat' {
  if (delta > 0.0005) return 'up';
  if (delta < -0.0005) return 'down';
  return 'flat';
}

export function PredictionCard({
  prediction,
  expanded = false,
  dense = false,
}: PredictionCardProps) {
  const { symbol, chain, horizon, direction, tier, emittedAt } = prediction;
  const outcome: Outcome = prediction.outcome ?? 'pending';
  const signals = prediction.triggerSnapshot?.vizzorTa.signals ?? [];

  return (
    <article
      className={cn(
        'flex flex-col gap-3 bg-[var(--surface)]',
        'border border-[var(--border)]',
        'transition-colors duration-150',
        'hover:border-[color-mix(in_oklab,var(--accent)_30%,var(--border))]',
        dense ? 'p-3 rounded-[12px]' : 'p-4 rounded-[14px]',
      )}
      aria-label={`Prediction for ${symbol} ${horizon}`}
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-[14px] tracking-tight text-[var(--fg)]">
            {symbol}
          </span>
          {chain && <ChainPill chain={chain} size="xs" showLabel={!dense} />}
          <HorizonChip horizon={horizon} />
        </div>
        <TierBadge tier={tier} size="sm" showLabel={!dense} />
      </header>

      {/* Body — predicted price */}
      <div className="flex items-baseline gap-2">
        <DirectionArrow direction={direction} />
        <span
          className={cn(
            'mono tabular font-bold leading-none text-[var(--fg)]',
            dense ? 'text-xl' : 'text-2xl',
          )}
        >
          {formatUsd(prediction.predictedPrice)}
        </span>
        <span className="mono tabular flex items-baseline gap-1 text-[11px] text-[var(--fg-3)]">
          <span>{formatUsd(prediction.entryPrice)}</span>
          <ArrowRight size={11} strokeWidth={1.75} aria-hidden />
        </span>
      </div>

      {/* Targets */}
      {prediction.targets && (
        <div className="grid grid-cols-3 gap-2">
          {(() => {
            const targets = prediction.targets;
            return (['bull', 'base', 'bear'] as const).map((key) => {
              const target = targets[key];
              const delta = deltaFromEntry(target, prediction.entryPrice);
              return (
                <DataTile
                  key={key}
                  label={key}
                  value={formatUsd(target)}
                  delta={delta}
                  direction={targetDirection(delta)}
                  size="sm"
                />
              );
            });
          })()}
        </div>
      )}

      {/* Receipts */}
      {expanded && signals.length > 0 && (
        <div className="flex flex-col gap-2 pt-1">
          <span className="eyebrow">Receipts</span>
          <div className="flex flex-col gap-2">
            {signals.map((s, i) => (
              <SignalRow key={`${s.family}-${i}`} signal={s} compact={dense} />
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="flex items-center justify-between pt-1 border-t border-[var(--border)] mt-auto">
        <div className="pt-2">
          <OutcomeChip outcome={outcome} />
        </div>
        <div className="pt-2 mono tabular text-[10px] text-[var(--fg-3)]">
          {relativeTime(emittedAt)}
        </div>
      </footer>
    </article>
  );
}
