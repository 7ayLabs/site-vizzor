'use client';

/**
 * HowItWorksClient — three product-mockup cards in a uniform 3-column
 * grid. Reads as feature cards, not engine diagnostics.
 *
 * Each card has:
 *   - Mono step number (top-left) + a TRACKED tag (top-right)
 *   - Bold display title
 *   - Short descriptive paragraph
 *   - Substantial product-mockup visual on the bottom half
 *
 * Visuals match the hero data cards' vocabulary: corner brackets
 * (vt-bracket), scanline overlay (vt-scanlines), hairline borders,
 * mono typography. Strict monochrome — the only color exception is
 * the scoped `--up` / `--down` direction tokens used on explicit
 * hit/miss glyphs (a11y carry-through for colorblind users).
 *
 * Reveal: GSAP stagger via runGsapReveal (same primitive used across
 * the marketing page). Reduced motion snaps each card to its final
 * state instantly.
 */

import { useEffect, useRef } from 'react';
import { runGsapReveal, useReducedMotionSafe } from '@/lib/motion';
import { CoinIcon } from '@/components/ui/coin-icon';
import { cn } from '@/lib/utils';

interface StepCopy {
  number: string;
  title: string;
  description: string;
}

export interface HowItWorksClientProps {
  steps: readonly [StepCopy, StepCopy, StepCopy];
}

export function HowItWorksClient({ steps }: HowItWorksClientProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<HTMLDivElement[]>([]);
  const reduced = useReducedMotionSafe();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const targets = cardRefs.current.filter(
      (el): el is HTMLDivElement => el !== null,
    );
    if (targets.length === 0) return;
    return runGsapReveal({
      root,
      targets,
      reduced,
      stagger: 0.14,
      duration: 0.6,
    });
  }, [reduced]);

  const setCardRef = (idx: number) => (el: HTMLDivElement | null): void => {
    if (el) cardRefs.current[idx] = el;
  };

  const visuals: readonly [React.ReactNode, React.ReactNode, React.ReactNode] = [
    <AskVisual key="v1" />,
    <CallVisual key="v2" />,
    <ScoreboardVisual key="v3" />,
  ];

  return (
    <div
      ref={rootRef}
      className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6 items-stretch"
    >
      {steps.map((step, idx) => (
        <article
          key={step.number}
          ref={setCardRef(idx)}
          className={cn(
            'group relative flex flex-col',
            'rounded-2xl bg-[var(--surface)] border border-[var(--border)]',
            'shadow-[0_8px_32px_-16px_rgba(0,0,0,0.18)]',
            'dark:shadow-[0_8px_32px_-10px_rgba(0,0,0,0.55)]',
            'transition-[transform,box-shadow,border-color] duration-300 ease-out',
            'hover:border-[var(--border-hi)]',
            'hover:shadow-[0_16px_40px_-16px_rgba(0,0,0,0.25)]',
            'motion-safe:hover:[transform:translateY(-2px)]',
            'overflow-hidden',
          )}
        >
          {/* ── Top: step number only ──────────────────────────────── */}
          <header className="px-7 pt-7">
            <span className="mono tabular text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--fg-3)]">
              {step.number}
            </span>
          </header>

          {/* ── Title + description ────────────────────────────────── */}
          <div className="px-7 pt-3 flex flex-col gap-2.5">
            <h3 className="display text-[20px] sm:text-[22px] leading-[1.1] tracking-[-0.02em] font-semibold text-[var(--fg)]">
              {step.title}
            </h3>
            <p className="text-[13.5px] leading-relaxed text-[var(--fg-2)] max-w-[42ch]">
              {step.description}
            </p>
          </div>

          {/* ── Visual ─────────────────────────────────────────────── */}
          <div className="px-5 pb-5 pt-5 mt-auto">{visuals[idx]}</div>
        </article>
      ))}
    </div>
  );
}

/* ─────────────────── shared visual chrome ─────────────────── */

function VisualFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'vt-bracket relative',
        'rounded-lg border border-[var(--border)]',
        'bg-[var(--bg)]',
        'overflow-hidden',
        className,
      )}
    >
      <span aria-hidden className="vt-scanlines absolute inset-0 rounded-lg" />
      <div className="relative p-4">{children}</div>
    </div>
  );
}

/* ─────────────────── 01 · ASK — chat composer mock ─────────────────── */

function AskVisual() {
  return (
    <VisualFrame className="min-h-[180px]">
      {/* Prompt bubble — user's incoming question */}
      <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 flex items-start gap-2">
        <span className="mono tabular text-[10px] uppercase tracking-[0.14em] text-[var(--fg-3)] shrink-0 pt-0.5">
          you
        </span>
        <span className="text-[12.5px] text-[var(--fg)] leading-snug">
          What is BTC doing this week?
        </span>
      </div>

      {/* Recent symbol chips — quick re-runs */}
      <div className="mt-3 flex items-center gap-1.5 flex-wrap">
        <span className="mono tabular text-[9px] uppercase tracking-[0.16em] text-[var(--fg-3)] mr-1">
          recent
        </span>
        {(['BTC', 'ETH', 'SOL', 'HYPE'] as const).map((sym) => (
          <span
            key={sym}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 mono tabular text-[10px] text-[var(--fg-2)]"
          >
            <CoinIcon symbol={sym} size={11} />
            {sym}
          </span>
        ))}
      </div>

      {/* Composer input line + submit cue */}
      <div className="mt-4 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] pl-3 pr-1 py-1">
        <span
          className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--fg)] motion-safe:animate-pulse shrink-0"
          aria-hidden
        />
        <span className="mono tabular text-[11px] text-[var(--fg-3)] flex-1 truncate">
          /predict SOL 1d
        </span>
        <span className="inline-flex items-center justify-center h-6 px-2.5 rounded-full bg-[var(--fg)] text-[var(--bg)] text-[10px] font-semibold tracking-tight">
          PREDICT →
        </span>
      </div>
    </VisualFrame>
  );
}

/* ─────────────────── 02 · GET A CALL — prediction receipt mock ─────────────── */

function CallVisual() {
  return (
    <VisualFrame className="min-h-[180px]">
      {/* Direction headline + confidence number */}
      <div className="flex items-center gap-4">
        <span
          className="display font-bold text-[42px] leading-none tracking-tight"
          style={{ color: 'var(--up)' }}
          aria-hidden
        >
          ↑
        </span>
        <div className="flex flex-col">
          <span className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)] leading-none">
            call
          </span>
          <span className="mono tabular text-[18px] font-bold text-[var(--fg)] leading-tight">
            LONG
          </span>
        </div>
        <div className="flex flex-col ml-auto items-end">
          <span className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)] leading-none">
            target
          </span>
          <span className="mono tabular text-[14px] font-semibold text-[var(--fg)] leading-tight">
            $69,420
          </span>
        </div>
      </div>

      {/* Signal-family bullet list — fills 4 of the 6 to suggest "most fired" */}
      <ul className="mt-4 flex flex-col gap-1.5">
        {[
          { name: 'ON-CHAIN', filled: true },
          { name: 'ML ENSEMBLE', filled: true },
          { name: 'MARKETS', filled: true },
          { name: 'PATTERN', filled: false },
        ].map((sig) => (
          <li
            key={sig.name}
            className="flex items-center gap-2 mono tabular text-[10px] uppercase tracking-[0.14em] text-[var(--fg-2)]"
          >
            <span
              aria-hidden
              className={cn(
                'inline-block h-1.5 w-6 rounded-full',
                sig.filled ? 'bg-[var(--fg)]' : 'bg-[var(--border)]',
              )}
            />
            <span className={sig.filled ? 'text-[var(--fg)]' : 'text-[var(--fg-3)]'}>
              {sig.name}
            </span>
          </li>
        ))}
      </ul>
    </VisualFrame>
  );
}

/* ─────────────────── 03 · TRACK — scoreboard + receipts mock ─────────── */

function ScoreboardVisual() {
  // Static mock — the LIVE wr ring on the hero is the dynamic one;
  // here we just need a believable still frame.
  const wrPercent = 0.724;
  const samples = 247;
  const recent: ReadonlyArray<{
    sym: string;
    outcome: 'hit' | 'miss' | 'neu';
  }> = [
    { sym: 'BTC', outcome: 'hit' },
    { sym: 'ETH', outcome: 'hit' },
    { sym: 'SOL', outcome: 'miss' },
    { sym: 'XRP', outcome: 'hit' },
    { sym: 'HYPE', outcome: 'neu' },
  ];

  return (
    <VisualFrame className="min-h-[180px]">
      {/* Mini WR ring + samples — static SVG so we don't double-mount
          the real WRRing primitive (which animates on prop change). */}
      <div className="flex items-center gap-4">
        <MiniWrRing percent={wrPercent} size={72} />
        <div className="flex flex-col">
          <span className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)] leading-none">
            tracked
          </span>
          <span className="mono tabular text-[20px] font-bold text-[var(--fg)] leading-tight">
            {samples}
          </span>
          <span className="mono tabular text-[10px] text-[var(--fg-3)] mt-0.5">
            calls audited
          </span>
        </div>
        {/* Right column: hit/miss/neu counts */}
        <div className="ml-auto flex flex-col gap-1 text-right">
          <CountRow label="HITS" count={128} tone="up" />
          <CountRow label="MISS" count={52} tone="down" />
          <CountRow label="NEU" count={14} tone="neutral" />
        </div>
      </div>

      {/* Recent receipts strip — last 5 outcomes as glyphs */}
      <div className="mt-4 flex items-center gap-1.5 flex-wrap">
        <span className="mono tabular text-[9px] uppercase tracking-[0.16em] text-[var(--fg-3)] mr-1">
          recent
        </span>
        {recent.map((r, i) => (
          <span
            key={`${r.sym}-${i}`}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-1.5 py-0.5 mono tabular text-[9.5px]"
          >
            <CoinIcon symbol={r.sym} size={10} />
            <span className="text-[var(--fg-2)]">{r.sym}</span>
            <span
              aria-hidden
              style={{
                color:
                  r.outcome === 'hit'
                    ? 'var(--up)'
                    : r.outcome === 'miss'
                      ? 'var(--down)'
                      : 'var(--fg-3)',
              }}
            >
              {r.outcome === 'hit' ? '✓' : r.outcome === 'miss' ? '✗' : '◌'}
            </span>
          </span>
        ))}
      </div>
    </VisualFrame>
  );
}

function CountRow({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: 'up' | 'down' | 'neutral';
}) {
  const color =
    tone === 'up'
      ? 'var(--up)'
      : tone === 'down'
        ? 'var(--down)'
        : 'var(--fg-3)';
  return (
    <span className="mono tabular text-[10.5px] inline-flex items-center justify-end gap-1.5">
      <span className="text-[var(--fg-3)] text-[9px] uppercase tracking-[0.16em]">
        {label}
      </span>
      <span className="font-semibold" style={{ color }}>
        {count}
      </span>
    </span>
  );
}

function MiniWrRing({ percent, size }: { percent: number; size: number }) {
  // Inline SVG so this visual stays self-contained (no separate mount,
  // no re-animation triggered by HoverIntent). Matches the WRRing
  // primitive's stroke logic in spirit but without the animation
  // keyframe — the card body's hover lift carries enough motion.
  const stroke = size / 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(1, percent)));
  const cx = size / 2;
  const cy = size / 2;
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 -rotate-90"
        aria-hidden
      >
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="var(--fg)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="relative mono tabular text-[13px] font-bold text-[var(--fg)] leading-none">
        {(percent * 100).toFixed(1)}%
      </span>
    </div>
  );
}
