/**
 * HorizonStrip — horizontal chip row for filtering by prediction horizon.
 *
 * Renders a leading "All" pill (selected when `selected === null`) followed
 * by one chip per horizon. Selected chip is filled with the brand accent;
 * unselected chips match the visual weight of ChainPill-sm so they recede
 * until interacted with.
 *
 * On narrow viewports the row scrolls horizontally — scrollbar is hidden
 * via inline style + a scoped CSS rule so the strip stays a clean band.
 *
 * When `sticky`, the strip pins below the 56px header (top-14) with the
 * same translucent backdrop as the header itself for visual continuity.
 */
'use client';

import { cn } from '@/lib/utils';

export interface HorizonStripProps {
  horizons: readonly string[];
  selected: string | null;
  onSelect: (h: string | null) => void;
  sticky?: boolean;
}

const CHIP_BASE =
  'inline-flex items-center justify-center h-7 px-3 text-[12px] mono tabular ' +
  'whitespace-nowrap rounded-full border ' +
  'transition-colors duration-150 ease-out';

const CHIP_UNSELECTED =
  'border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-2)] ' +
  'hover:bg-[var(--surface-2)] hover:text-[var(--fg)] hover:border-[var(--fg-3)]';

const CHIP_SELECTED =
  'border-transparent bg-[var(--accent)] text-[var(--accent-fg)]';

export function HorizonStrip({
  horizons,
  selected,
  onSelect,
  sticky = false,
}: HorizonStripProps) {
  return (
    <div
      className={cn(
        sticky &&
          'sticky top-14 z-30 bg-[var(--bg)]/85 backdrop-blur-md border-b border-[var(--border)] py-2',
      )}
    >
      <div
        role="tablist"
        aria-label="Horizon filter"
        className="horizon-strip-scroll flex items-center gap-1.5 overflow-x-auto"
        style={{
          msOverflowStyle: 'none',
          scrollbarWidth: 'none',
        }}
      >
        <style>{`.horizon-strip-scroll::-webkit-scrollbar { display: none; }`}</style>

        <button
          type="button"
          role="tab"
          aria-selected={selected === null}
          onClick={() => onSelect(null)}
          className={cn(CHIP_BASE, selected === null ? CHIP_SELECTED : CHIP_UNSELECTED)}
        >
          All
        </button>

        {horizons.map((h) => {
          const isSelected = selected === h;
          return (
            <button
              key={h}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => onSelect(h)}
              className={cn(CHIP_BASE, isSelected ? CHIP_SELECTED : CHIP_UNSELECTED)}
            >
              {h}
            </button>
          );
        })}
      </div>
    </div>
  );
}
