/**
 * SixSignalsClient — drives the six-pillar "Built for Web3" moment.
 *
 * Left  : dynamically-imported `<SignalOrbital>` (R3F never lands in SSR).
 * Right : six pillar cards. IntersectionObserver picks the most-visible
 *         card and lifts `activeIndex`, which highlights the row and
 *         brightens the matching orbital node.
 *
 * Reduced-motion users skip the IO highlight; the first row stays active.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useReducedMotionSafe } from '@/lib/motion';
import { cn } from '@/lib/utils';

const SignalOrbital = dynamic(
  () =>
    import('@/components/three/signal-orbital').then((m) => ({
      default: m.SignalOrbital,
    })),
  { ssr: false },
);

export interface SixSignalsRowCopy {
  key: string;
  title: string;
  description: string;
  reveal: string;
  ariaLabel: string;
}

export interface SixSignalsClientProps {
  rows: readonly SixSignalsRowCopy[];
}

export function SixSignalsClient({ rows }: SixSignalsClientProps) {
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const reduced = useReducedMotionSafe();
  const rowRefs = useRef<HTMLLIElement[]>([]);

  useEffect(() => {
    if (reduced) return;
    const targets = rowRefs.current.filter(
      (el): el is HTMLLIElement => el !== null,
    );
    if (targets.length === 0) return;

    const ratios = new Map<Element, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(entry.target, entry.intersectionRatio);
        }
        let best = -1;
        let bestRatio = 0;
        targets.forEach((el, idx) => {
          const r = ratios.get(el) ?? 0;
          if (r > bestRatio) {
            bestRatio = r;
            best = idx;
          }
        });
        if (best !== -1) setActiveIdx(best);
      },
      {
        threshold: [0.2, 0.4, 0.6, 0.8],
        rootMargin: '-30% 0px -30% 0px',
      },
    );
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [reduced, rows.length]);

  const setRowRef = (idx: number) => (el: HTMLLIElement | null): void => {
    if (el) rowRefs.current[idx] = el;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-12 lg:gap-16 items-start">
      <div className="relative">
        <div className="sticky top-24">
          <SignalOrbital activeIndex={activeIdx} height={420} />
        </div>
      </div>

      <ol className="flex flex-col gap-3" aria-label="Web3 pillars">
        {rows.map((row, idx) => {
          const active = idx === activeIdx;
          return (
            <li
              key={row.key}
              ref={setRowRef(idx)}
              aria-label={row.ariaLabel}
              className={cn(
                'flex flex-col gap-2 rounded-md p-5 transition-colors duration-200',
                'border',
                active
                  ? 'border-[var(--accent)] bg-[var(--surface)] vt-glow-mint'
                  : 'border-[var(--border)] bg-[var(--surface)]/60',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] font-semibold leading-tight text-[var(--fg)]">
                  {row.title}
                </span>
                <span className="mono tabular text-[9.5px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-3)]">
                  {String(idx + 1).padStart(2, '0')}
                </span>
              </div>
              <p className="text-[13px] text-[var(--fg-2)] leading-relaxed">
                {row.description}
              </p>
              <p
                className={cn(
                  'mono text-[11px] uppercase tracking-[0.14em]',
                  active ? 'text-[var(--accent)]' : 'text-[var(--fg-3)]',
                )}
              >
                {row.reveal}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
