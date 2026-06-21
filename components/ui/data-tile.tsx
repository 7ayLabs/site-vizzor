/**
 * DataTile — the canonical info tile for vizzor.ai dense layouts.
 * Uppercase micro label, bold mono-tabular value, optional delta line.
 * Color-key: accent for up, danger for down, fg-3 for flat.
 * Caller pre-formats numeric values with formatUsd / formatPct from @/lib/utils.
 *
 * Variants:
 *   - `flat` (default) — current behavior, unchanged.
 *   - `terminal` — Bloomberg-style: L-shaped corner brackets in accent,
 *     stronger inner padding, hairline border in --border-hi, optional
 *     pulsing live dot in the top-right corner.
 */

import { cn } from '@/lib/utils';

export type DataTileVariant = 'flat' | 'terminal';

export interface DataTileProps {
  label: string;
  value: string | number;
  delta?: number;
  direction?: 'up' | 'down' | 'flat';
  size?: 'sm' | 'md' | 'lg';
  hint?: string;
  /** Visual variant — defaults to `flat` to preserve current call sites. */
  variant?: DataTileVariant;
  /**
   * Terminal variant only: when true, renders a pulsing live dot in the
   * top-right corner. Ignored on `flat` for backward compatibility.
   */
  live?: boolean;
}

const sizeClasses: Record<NonNullable<DataTileProps['size']>, { pad: string; padTerm: string; value: string; label: string }> = {
  sm: {
    pad: 'p-3',
    padTerm: 'p-4',
    value: 'text-base sm:text-lg',
    label: 'text-[10px]',
  },
  md: {
    pad: 'p-4',
    padTerm: 'p-5',
    value: 'text-xl sm:text-2xl',
    label: 'text-[11px]',
  },
  lg: {
    pad: 'p-5',
    padTerm: 'p-6',
    value: 'text-2xl sm:text-3xl',
    label: 'text-[11px]',
  },
};

function resolveDirection(
  direction: DataTileProps['direction'],
  delta: number | undefined,
): 'up' | 'down' | 'flat' {
  if (direction) return direction;
  if (delta === undefined) return 'flat';
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

function formatDelta(delta: number): string {
  const sign = delta > 0 ? '+' : '';
  return `${sign}${(delta * 100).toFixed(2)}%`;
}

export function DataTile({
  label,
  value,
  delta,
  direction,
  size = 'md',
  hint,
  variant = 'flat',
  live = false,
}: DataTileProps) {
  const s = sizeClasses[size];
  const dir = resolveDirection(direction, delta);
  const isTerminal = variant === 'terminal';

  const deltaColor =
    dir === 'up'
      ? 'text-[var(--accent)]'
      : dir === 'down'
        ? 'text-[var(--danger)]'
        : 'text-[var(--fg-3)]';

  return (
    <div
      className={cn(
        'group relative flex flex-col gap-1.5',
        'rounded-lg bg-[var(--surface)]',
        'transition-transform duration-100 ease-out',
        'hover:-translate-y-px',
        isTerminal
          ? cn('vt-bracket border border-[var(--border-hi)]', s.padTerm)
          : cn('border border-[var(--border)]', s.pad),
      )}
    >
      {isTerminal && live && (
        <span
          aria-hidden
          className="absolute right-3 top-3 inline-block h-1.5 w-1.5 rounded-full"
          style={{
            background: 'var(--accent)',
            animation: 'pulse-dot 1.6s ease-in-out infinite',
          }}
        />
      )}

      <div
        className={cn(
          'font-semibold uppercase tracking-[0.16em] text-[var(--fg-3)] leading-none',
          s.label,
        )}
      >
        {label}
      </div>

      <div
        className={cn(
          'mono tabular font-bold leading-none text-[var(--fg)]',
          s.value,
        )}
      >
        {value}
      </div>

      {delta !== undefined && (
        <div className={cn('mono tabular text-[11px] leading-none', deltaColor)}>
          {formatDelta(delta)}
        </div>
      )}

      {hint && (
        <div className="text-[10px] leading-tight text-[var(--fg-3)]">{hint}</div>
      )}
    </div>
  );
}
