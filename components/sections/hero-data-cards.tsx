'use client';

/**
 * HeroDataCards — three floating "terminal display" cards that anchor
 * the right side of the redesigned hero.
 *
 * Composition note: the visual reference (a generic SaaS fintech hero
 * with glassmorphic blue/purple cards) is reinterpreted through
 * Vizzor's strict monochrome aesthetic: corner brackets, scanlines,
 * hairline borders, mono typography. The *layout language* (asymmetric
 * overlap, dense above-the-fold data, slight off-axis tilt) is
 * preserved; the *chrome language* is Bloomberg-terminal, not glass.
 *
 * Each card fetches live data via the same SWR hooks the rest of the
 * site uses (`useTrackerWR`, `useTicker`, `useRecentPredictions`) so
 * the hero is genuine product evidence, not decorative imagery. When
 * the API is unreachable the hooks fall back to the build-time snapshot
 * — visitors never see broken numbers.
 *
 * Animation scope (per your direction): the cards themselves stay
 * STATIC except for the slow Y-axis drift loop and the GSAP stagger-in
 * on first paint. The animation budget goes to the values inside —
 * numbers tween via `AnimatedNumber`, up/down chevrons flash on Δ
 * change (louder on direction reversal), receipt badges fade-swap on
 * outcome resolution. No card-level carousel, no channel sweep, no
 * glitch eyebrow, no pip progress.
 *
 * All animations are gated by `motion-safe:` or by `AnimatedNumber`'s
 * own reduced-motion check, so the entire animation layer collapses
 * under `prefers-reduced-motion: reduce`.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useTicker, useTrackerWR, useRecentPredictions } from '@/lib/api';
import { useReducedMotionSafe, runGsapReveal } from '@/lib/motion';
import { WRRing } from '@/components/ui/wr-ring';
import { CoinIcon } from '@/components/ui/coin-icon';
import { AnimatedNumber } from '@/components/ui/animated-number';
import type { Prediction, TickerEntry } from '@/lib/types';

const TICKER_TOP_N = 4;
const RECEIPTS_LIMIT = 4;

export function HeroDataCards() {
  const reduced = useReducedMotionSafe();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const trackerWR = useTrackerWR(60_000);
  const ticker = useTicker(30_000);
  const recents = useRecentPredictions({ limit: RECEIPTS_LIMIT });

  const topTickers = useMemo(
    () => ticker.data.slice(0, TICKER_TOP_N),
    [ticker.data],
  );

  // Stagger-reveal the three cards on first paint via the canonical
  // IntersectionObserver-driven helper.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-hero-card]'));
    return runGsapReveal({
      root,
      targets: cards,
      reduced,
      stagger: 0.14,
      duration: 0.8,
    });
  }, [reduced]);

  return (
    <div
      ref={rootRef}
      aria-hidden={false}
      className="relative w-full h-[480px] sm:h-[540px] lg:h-[600px]"
    >
      {/* Atmospheric isometric grid behind the cards. Pure CSS,
          monochrome, masked to fade at the edges. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18] dark:opacity-[0.22] pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(to right, var(--border) 1px, transparent 1px),
            linear-gradient(to bottom, var(--border) 1px, transparent 1px)
          `,
          backgroundSize: '32px 32px',
          maskImage:
            'radial-gradient(ellipse 70% 60% at 60% 50%, black 30%, transparent 80%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 70% 60% at 60% 50%, black 30%, transparent 80%)',
        }}
      />

      {/* Card 1 — TRACKER WR. Top-right anchor, slight ccw tilt. */}
      <TerminalCard
        dataAttr="card-wr"
        className="
          absolute top-0 right-0 w-[280px] sm:w-[300px]
          lg:[transform:rotate(-1.2deg)]
          motion-safe:lg:[animation:hero-card-drift-a_6.5s_ease-in-out_infinite]
        "
      >
        <TrackerWRBody
          wr={trackerWR.data.aggregate.wr}
          samples={trackerWR.data.aggregate.samples}
        />
      </TerminalCard>

      {/* Card 2 — LIVE TICKER. Center-left, foreground stack. */}
      <TerminalCard
        dataAttr="card-ticker"
        className="
          absolute top-[30%] left-0 w-[300px] sm:w-[320px]
          lg:[transform:rotate(0.8deg)]
          motion-safe:lg:[animation:hero-card-drift-b_7.2s_ease-in-out_infinite_0.3s]
          z-10
        "
      >
        <TickerBody entries={topTickers} />
      </TerminalCard>

      {/* Card 3 — RECEIPTS. Bottom-right. */}
      <TerminalCard
        dataAttr="card-receipts"
        className="
          absolute bottom-0 right-[3%] w-[340px] sm:w-[380px]
          lg:[transform:rotate(-0.6deg)]
          motion-safe:lg:[animation:hero-card-drift-c_8s_ease-in-out_infinite_0.6s]
        "
      >
        <ReceiptsBody predictions={recents.data} />
      </TerminalCard>
    </div>
  );
}

/* ─────────────────────────── card shell ─────────────────────────── */

function TerminalCard({
  children,
  className,
  dataAttr,
}: {
  children: React.ReactNode;
  className?: string;
  dataAttr: string;
}) {
  return (
    <div
      data-hero-card={dataAttr}
      className={`group will-change-transform ${className ?? ''}`}
    >
      <div
        className="
          vt-bracket relative
          border border-[var(--border)] bg-[var(--surface)]
          rounded-md
          shadow-[0_24px_60px_-28px_rgba(0,0,0,0.35)]
          dark:shadow-[0_24px_60px_-22px_rgba(0,0,0,0.7)]
          transition-[border-color,box-shadow] duration-300 ease-out
          hover:border-[var(--border-hi)]
          hover:shadow-[0_28px_72px_-24px_rgba(0,0,0,0.45)]
          dark:hover:shadow-[0_28px_72px_-18px_rgba(0,0,0,0.85)]
          overflow-hidden
        "
      >
        {/* Scanline overlay — pinned absolute so it doesn't push content. */}
        <span aria-hidden className="vt-scanlines absolute inset-0 rounded-md" />

        <div className="relative p-5">{children}</div>
      </div>
    </div>
  );
}

/* ─────────────────────────── card bodies ─────────────────────────── */

function TrackerWRBody({ wr, samples }: { wr: number; samples: number }) {
  return (
    <div className="flex items-center gap-4">
      <WRRing percent={wr} samples={samples} size={108} variant="classic" />
      <div className="flex flex-col gap-1.5 min-w-0">
        <p className="text-[13px] font-semibold text-[var(--fg)] leading-tight">
          Calibrated win rate
        </p>
        <p className="mono tabular text-[10.5px] text-[var(--fg-3)] leading-relaxed">
          Public ledger.
          <br />
          Hit / miss audited.
        </p>
        {/* Samples tally — ticks up to its real value on first paint
            (and on the very rare case the count updates between SWR
            refreshes). The WR % display lives inside the ring itself
            (managed by WRRing's own dashoffset keyframe). */}
        <p className="mono tabular text-[10.5px] text-[var(--fg-2)] mt-1">
          <AnimatedNumber
            value={samples}
            format="int"
            duration={1100}
            className="mono tabular text-[var(--fg)] font-semibold"
          />
          <span className="ml-1 text-[var(--fg-3)]">tracked</span>
        </p>
      </div>
    </div>
  );
}

function TickerBody({
  entries,
}: {
  entries: ReadonlyArray<TickerEntry>;
}) {
  return (
    <ul className="flex flex-col divide-y divide-[var(--border)] -mx-1">
      {entries.map((e) => {
        const up = e.changePct >= 0;
        const pct = Math.abs(e.changePct) * 100;
        return (
          <li key={e.symbol} className="flex items-center gap-2.5 px-1 py-1.5">
            <CoinIcon symbol={e.symbol} size={18} />
            <span className="mono tabular text-[12px] font-semibold text-[var(--fg)] flex-1 truncate">
              {e.symbol}
            </span>
            {/* Price — tweens from old to new on each SWR refresh. */}
            <AnimatedNumber
              value={e.price}
              format="usd"
              duration={650}
              className="mono tabular text-[11.5px] text-[var(--fg-2)] tracking-tight"
            />
            <DeltaChevron
              symbol={e.symbol}
              up={up}
              pct={pct}
            />
          </li>
        );
      })}
    </ul>
  );
}

function ReceiptsBody({
  predictions,
}: {
  predictions: ReadonlyArray<Prediction>;
}) {
  const rows = predictions.slice(0, RECEIPTS_LIMIT);
  return (
    <ul className="flex flex-col divide-y divide-[var(--border)] -mx-1">
      {rows.map((p) => {
        const status = receiptStatus(p.outcome);
        return (
          <li key={p.id} className="flex items-center gap-2.5 px-1 py-1.5">
            <CoinIcon symbol={p.symbol} size={16} />
            <span className="mono tabular text-[11.5px] font-semibold text-[var(--fg)] w-[42px]">
              {p.symbol}
            </span>
            <span className="mono tabular text-[10px] uppercase tracking-[0.12em] text-[var(--fg-3)] w-[36px]">
              {p.horizon}
            </span>
            <span className="mono tabular text-[10px] uppercase tracking-[0.12em] text-[var(--fg-2)] flex-1 inline-flex items-baseline gap-1">
              <span>
                {p.direction === 'up'
                  ? '↑ LONG'
                  : p.direction === 'down'
                    ? '↓ SHORT'
                    : '→ FLAT'}
              </span>
              <span className="text-[var(--fg-3)]">·</span>
              <AnimatedNumber
                value={p.confidence * 100}
                format="pct"
                decimals={0}
                duration={900}
                className="mono tabular text-[var(--fg-2)]"
              />
            </span>
            <ReceiptBadge predictionId={p.id} status={status} />
          </li>
        );
      })}
    </ul>
  );
}

/* ─────────────────────────── micro-animated atoms ─────────────────────────── */

/**
 * DeltaChevron — the ▲/▼ + percent glyph for a ticker row.
 *
 * Animation contract:
 *   - When `pct` rounds to a new integer (the visible value changes),
 *     the chevron+number scale-pulses once via `hero-delta-flash`.
 *   - When `up` flips (direction reversal), the louder
 *     `hero-delta-flash-flip` variant fires instead so reversals read
 *     at a glance.
 *
 * Implementation: a React `key` derived from the displayed magnitude
 * + sign forces the element to remount each time it should re-fire.
 * `previousUpRef` survives across remounts because the parent stays
 * mounted, letting us distinguish "magnitude change" from "sign flip".
 */
function DeltaChevron({
  symbol,
  up,
  pct,
}: {
  symbol: string;
  up: boolean;
  pct: number;
}) {
  const previousUpRef = useRef<boolean | null>(null);
  // Round to the same precision we display so we don't pulse on
  // sub-pixel decimal noise.
  const displayedMag = pct.toFixed(pct >= 10 ? 1 : 2);
  const flipped =
    previousUpRef.current !== null && previousUpRef.current !== up;
  // Update the ref AFTER computing flipped so the next render's
  // comparison reflects the now-current direction.
  useEffect(() => {
    previousUpRef.current = up;
  }, [up]);

  const animationClass = flipped
    ? 'motion-safe:[animation:hero-delta-flash-flip_320ms_ease-out]'
    : 'motion-safe:[animation:hero-delta-flash_280ms_ease-out]';

  return (
    <span
      key={`${symbol}-${up ? 'u' : 'd'}-${displayedMag}`}
      className={`
        mono tabular text-[10.5px] inline-flex items-center gap-0.5 w-[64px] justify-end
        ${animationClass}
      `}
      style={{ color: up ? 'var(--up)' : 'var(--down)' }}
    >
      <span aria-hidden>{up ? '▲' : '▼'}</span>
      <span>{displayedMag}%</span>
    </span>
  );
}

/**
 * ReceiptBadge — fade-swaps when the outcome resolves (pending → hit
 * / miss / neutral). Keyed by predictionId+status so a single row
 * changing outcome re-fires the keyframe without disrupting siblings.
 */
function ReceiptBadge({
  predictionId,
  status,
}: {
  predictionId: string;
  status: 'hit' | 'miss' | 'neutral' | 'pending';
}) {
  const animationClass =
    'motion-safe:[animation:hero-badge-swap_280ms_ease-out]';
  const key = `${predictionId}-${status}`;

  if (status === 'pending') {
    return (
      <span
        key={key}
        className={`
          mono tabular text-[9px] uppercase tracking-[0.14em] text-[var(--fg-3)]
          inline-flex items-center gap-1
          ${animationClass}
        `}
      >
        <span className="h-1 w-1 rounded-full bg-[var(--fg-3)] motion-safe:animate-pulse" />
        PEND
      </span>
    );
  }
  if (status === 'hit') {
    return (
      <span
        key={key}
        className={`mono tabular text-[9px] uppercase tracking-[0.14em] ${animationClass}`}
        style={{ color: 'var(--up)' }}
      >
        ✓ HIT
      </span>
    );
  }
  if (status === 'miss') {
    return (
      <span
        key={key}
        className={`mono tabular text-[9px] uppercase tracking-[0.14em] ${animationClass}`}
        style={{ color: 'var(--down)' }}
      >
        ✗ MISS
      </span>
    );
  }
  return (
    <span
      key={key}
      className={`mono tabular text-[9px] uppercase tracking-[0.14em] text-[var(--fg-3)] ${animationClass}`}
    >
      ◌ NEU
    </span>
  );
}

/* ─────────────────────────── helpers ─────────────────────────── */

function receiptStatus(outcome?: string): 'hit' | 'miss' | 'neutral' | 'pending' {
  if (outcome === 'hit') return 'hit';
  if (outcome === 'miss') return 'miss';
  if (outcome === 'neutral') return 'neutral';
  return 'pending';
}
