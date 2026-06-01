/**
 * DataTile — the canonical info tile for vizzor.ai dense layouts.
 * Uppercase micro label, bold mono-tabular value, optional delta line.
 * Color-key: accent for up, danger for down, fg-3 for flat.
 * Caller pre-formats numeric values with formatUsd / formatPct from @/lib/utils.
 */

import { cn } from '@/lib/utils';

export interface DataTileProps {
  label: string;
  value: string | number;
  delta?: number;
  direction?: 'up' | 'down' | 'flat';
  size?: 'sm' | 'md' | 'lg';
  hint?: string;
}

const sizeClasses: Record<NonNullable<DataTileProps['size']>, { pad: string; value: string; label: string }> = {
  sm: {
    pad: 'p-3',
    value: 'text-base sm:text-lg',
    label: 'text-[10px]',
  },
  md: {
    pad: 'p-4',
    value: 'text-xl sm:text-2xl',
    label: 'text-[11px]',
  },
  lg: {
    pad: 'p-5',
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
}: DataTileProps) {
  const s = sizeClasses[size];
  const dir = resolveDirection(direction, delta);

  const deltaColor =
    dir === 'up'
      ? 'text-[var(--accent)]'
      : dir === 'down'
        ? 'text-[var(--danger)]'
        : 'text-[var(--fg-3)]';

  return (
    <div
      className={cn(
        'group flex flex-col gap-1.5',
        'rounded-lg border border-[var(--border)] bg-[var(--surface)]',
        'transition-transform duration-100 ease-out',
        'hover:-translate-y-px',
        s.pad,
      )}
    >
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
