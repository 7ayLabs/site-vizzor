/**
 * SurfaceCompareTabs — mobile-only tablist for the three surface cards.
 *
 * Desktop layout (>=lg) renders all three panels side-by-side and this
 * wrapper is a no-op pass-through. Below `lg` it exposes a real tablist
 * with arrow-key navigation and visible focus styles, conforming to
 * WAI-ARIA Authoring Practices for tabs.
 *
 * No animation library — a tiny CSS-only fade keeps the bundle delta
 * minimal and the reduced-motion behavior automatic via the global rule.
 */
'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface SurfaceTabSpec {
  id: 'telegram' | 'cli' | 'dashboard';
  label: string;
  panel: React.ReactNode;
}

export interface SurfaceCompareTabsProps {
  tabs: readonly [SurfaceTabSpec, SurfaceTabSpec, SurfaceTabSpec];
}

export function SurfaceCompareTabs({ tabs }: SurfaceCompareTabsProps) {
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const tablistId = useId();
  const tabRefs = useRef<HTMLButtonElement[]>([]);

  const setRef = (idx: number) => (el: HTMLButtonElement | null): void => {
    if (el) tabRefs.current[idx] = el;
  };

  const focusTab = useCallback((idx: number): void => {
    const clamped = (idx + tabs.length) % tabs.length;
    setActiveIdx(clamped);
    const next = tabRefs.current[clamped];
    if (next) next.focus();
  }, [tabs.length]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusTab(activeIdx + 1);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        focusTab(activeIdx - 1);
        return;
      case 'Home':
        event.preventDefault();
        focusTab(0);
        return;
      case 'End':
        event.preventDefault();
        focusTab(tabs.length - 1);
        return;
      default:
        return;
    }
  };

  return (
    <>
      {/* Desktop — render all three panels in a grid */}
      <div className="hidden lg:grid lg:grid-cols-3 gap-6">
        {tabs.map((tab) => (
          <div key={tab.id}>{tab.panel}</div>
        ))}
      </div>

      {/* Mobile — tablist */}
      <div className="lg:hidden">
        <div
          role="tablist"
          aria-label="Surface comparison"
          className="flex items-center gap-1 p-1 rounded-full border border-[var(--border)] bg-[var(--surface)] mx-auto w-fit max-w-full overflow-x-auto"
        >
          {tabs.map((tab, idx) => {
            const selected = idx === activeIdx;
            return (
              <button
                key={tab.id}
                ref={setRef(idx)}
                role="tab"
                type="button"
                id={`${tablistId}-tab-${tab.id}`}
                aria-controls={`${tablistId}-panel-${tab.id}`}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveIdx(idx)}
                onKeyDown={onKeyDown}
                className={cn(
                  'mono tabular px-3 h-8 rounded-full whitespace-nowrap',
                  'text-[11px] font-semibold uppercase tracking-[0.18em]',
                  'transition-colors duration-150',
                  'focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2',
                  selected
                    ? 'bg-[var(--fg)] text-[var(--bg)]'
                    : 'text-[var(--fg-3)] hover:text-[var(--fg)]',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="mt-6">
          {tabs.map((tab, idx) => {
            const selected = idx === activeIdx;
            return (
              <div
                key={tab.id}
                role="tabpanel"
                id={`${tablistId}-panel-${tab.id}`}
                aria-labelledby={`${tablistId}-tab-${tab.id}`}
                hidden={!selected}
                tabIndex={0}
                className="focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2 rounded-lg"
              >
                {tab.panel}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
