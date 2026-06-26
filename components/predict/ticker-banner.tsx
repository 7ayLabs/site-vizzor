'use client';

/**
 * TickerBanner — instrument context card rendered between the user
 * message and the assistant response whenever the user mentions a
 * ticker (BTC, $ETH, Bitcoin, etc.).
 *
 * UX rationale (senior financial UX):
 *   - Mirrors the figure structure of the X / Robinhood / CoinGecko
 *     compact ticker card: icon LEFT, identity + price STACKED, chart
 *     RIGHT taking ~40% of the card width. The chart isn't an
 *     afterthought — it carries the same visual weight as the price.
 *   - Sits between the user bubble and the assistant bubble so it
 *     reads as "here's the ground truth you just asked about" before
 *     the model adds its analysis on top.
 *   - Data is sourced from `/api/ticker` which now hits the Vizzor
 *     engine (Binance + CoinGecko aggregated) first. Same prices the
 *     AI sees when it composes trade plans — kills the UI/AI price
 *     divergence class of bug.
 *
 * Visual contract:
 *   - Rounded-2xl card with directional glow tinted by 24h delta
 *     (subtle radial gradient — financial signal without shouting).
 *   - Sparkline draws itself in on mount via stroke-dashoffset.
 *   - Price node replays a `vz-price-tick` keyframe on every price
 *     change (brief brightness pulse + sub-pixel lift). Reads as
 *     "the number just updated", not as "look at me, animation".
 *   - 24h-open dashed reference line so the curve reads vs context,
 *     not just shape.
 *
 * Reduced-motion: all animations collapse to instant via the global
 * `prefers-reduced-motion: reduce` media block in globals.css.
 */

import { useMemo, useState } from 'react';
import { BarChart3, ChevronDown, ChevronUp } from 'lucide-react';
import { CoinIcon } from '@/components/ui/coin-icon';
import { cn } from '@/lib/utils';

export interface TickerBannerProps {
  symbol: string;
  name?: string;
  price?: number;
  changePct?: number;
  history?: ReadonlyArray<number>;
  className?: string;
}

const SPARKLINE_MIN_SAMPLES = 2;

export function TickerBanner({
  symbol,
  name,
  price,
  changePct,
  history,
  className,
}: TickerBannerProps) {
  const isUp = (changePct ?? 0) >= 0;
  const deltaColor = isUp ? 'var(--up)' : 'var(--down)';
  const deltaPct = typeof changePct === 'number' ? changePct * 100 : null;
  const upperSymbol = symbol.toUpperCase();

  const openPrice = useMemo(() => {
    if (typeof price !== 'number' || typeof changePct !== 'number') return null;
    if (price <= 0) return null;
    const denom = 1 + changePct;
    if (denom <= 0) return null;
    return price / denom;
  }, [price, changePct]);

  const hasEnoughSamples = (history?.length ?? 0) >= SPARKLINE_MIN_SAMPLES;

  return (
    <article
      aria-label={`${name ?? upperSymbol} live ticker`}
      // Directional glow: the `--vz-glow` custom property is consumed
      // by `vz-banner-glow::before` so the radial tint flips with the
      // 24h direction (up = green-ish, down = red-ish, both at low
      // alpha so the card stays monochrome-dominant).
      style={{ ['--vz-glow' as string]: deltaColor }}
      className={cn(
        'vz-banner-glow',
        // Match the assistant bubble's max width so the banner reads
        // as part of the chat column, not as edge-to-edge chrome.
        'max-w-[42rem] w-full',
        'relative overflow-hidden isolate',
        // iOS-clean: gentle rounding, hairline border at low alpha,
        // soft translucent fill. Sits inside the thread rather than
        // hovering above it.
        'rounded-xl border border-[var(--border)]/60',
        'bg-[color-mix(in_oklab,var(--surface)_70%,transparent)]',
        'vz-bubble-in-left',
        className,
      )}
    >
      <div className="relative z-10 flex items-center min-h-[52px]">
        <div className="flex items-center gap-2.5 px-3 py-2 min-w-0 flex-1">
          <CoinIcon symbol={upperSymbol} size={28} />
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-baseline gap-1.5 min-w-0">
              <h3 className="text-[13px] leading-[1.15] tracking-[-0.01em] font-semibold text-[var(--fg)] truncate">
                {name ?? upperSymbol}
              </h3>
              <span className="mono tabular text-[9.5px] uppercase tracking-[0.16em] text-[var(--fg-3)] shrink-0">
                {upperSymbol}
              </span>
            </div>
            <div className="flex items-baseline gap-2 min-w-0">
              {/* Price node replays the tick keyframe on every change
                  via a price-keyed remount. */}
              <span
                key={typeof price === 'number' ? price : 'na'}
                className="motion-safe:vz-price-tick mono tabular text-[14px] leading-none font-semibold tracking-[-0.01em] text-[var(--fg)] truncate"
              >
                {typeof price === 'number' && price > 0 ? formatBannerPrice(price) : '—'}
              </span>
              {deltaPct !== null && Number.isFinite(deltaPct) && (
                <span
                  className="mono tabular text-[10.5px] font-semibold inline-flex items-center gap-0.5 shrink-0"
                  style={{ color: deltaColor }}
                  aria-label={`24h change ${deltaPct.toFixed(2)} percent`}
                >
                  <span aria-hidden>{isUp ? '▲' : '▼'}</span>
                  {Math.abs(deltaPct).toFixed(2)}%
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Compact chart — kept on the right edge, smaller width so
            the card stays inside chat-bubble proportions. Hidden on
            mobile to keep the price the primary read. */}
        <div className="hidden sm:block self-stretch w-[120px] shrink-0 relative">
          {hasEnoughSamples ? (
            <SmoothSparkline
              history={history!}
              openPrice={openPrice}
              color={deltaColor}
              symbol={upperSymbol}
              className="absolute inset-0 w-full h-full"
            />
          ) : (
            <SparklinePlaceholder className="absolute inset-0 w-full h-full" />
          )}
        </div>
      </div>
    </article>
  );
}

/* ─────────────────────── sparkline ─────────────────────── */

/**
 * Smooth Catmull-Rom sparkline with a dashed 24h-open reference
 * line, multi-stop fill gradient, and a one-time draw-in animation
 * on mount.
 */
function SmoothSparkline({
  history,
  openPrice,
  color,
  symbol,
  className,
}: {
  history: ReadonlyArray<number>;
  openPrice: number | null;
  color: string;
  symbol: string;
  className?: string;
}) {
  const W = 120;
  const H = 52;
  const PADDING = 4;
  const drawH = H - PADDING * 2;

  const samples = history.filter((n) => Number.isFinite(n) && n > 0);
  const ranges: number[] = [...samples];
  if (typeof openPrice === 'number' && openPrice > 0) ranges.push(openPrice);
  const min = Math.min(...ranges);
  const max = Math.max(...ranges);
  const span = max - min || 1;
  const stepX = W / (samples.length - 1);

  const points: [number, number][] = samples.map((p, i) => {
    const x = i * stepX;
    const y = PADDING + (1 - (p - min) / span) * drawH;
    return [x, y];
  });

  const linePath = catmullRomToBezier(points);
  const fillPath = `${linePath} L${W},${H} L0,${H} Z`;

  const referenceY =
    typeof openPrice === 'number' && openPrice > 0
      ? PADDING + (1 - (openPrice - min) / span) * drawH
      : null;

  const lastPoint = points[points.length - 1];
  const gradientId = `vz-spark-fill-${symbol.toLowerCase()}`;
  const lineGradientId = `vz-spark-line-${symbol.toLowerCase()}`;

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.32} />
          <stop offset="55%" stopColor={color} stopOpacity={0.1} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
        <linearGradient id={lineGradientId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity={0.55} />
          <stop offset="100%" stopColor={color} stopOpacity={1} />
        </linearGradient>
      </defs>

      {/* Fill */}
      <path d={fillPath} fill={`url(#${gradientId})`} stroke="none" />

      {/* 24h-open reference line */}
      {referenceY !== null && (
        <line
          x1={0}
          x2={W}
          y1={referenceY}
          y2={referenceY}
          stroke="var(--fg-3)"
          strokeOpacity={0.4}
          strokeWidth={0.8}
          strokeDasharray="3 3"
        />
      )}

      {/* Smooth curve — draws itself in via stroke-dashoffset on
          first mount. */}
      <path
        d={linePath}
        fill="none"
        stroke={`url(#${lineGradientId})`}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="motion-safe:vz-spark-draw"
      />

      {/* Latest-point anchor — tiny filled dot. */}
      {lastPoint && (
        <circle
          cx={lastPoint[0]}
          cy={lastPoint[1]}
          r={1.4}
          fill={color}
        />
      )}
    </svg>
  );
}

/**
 * Pre-data placeholder — a single dashed mid-line. Reads as "chart
 * axis at rest"; users barely register it.
 */
function SparklinePlaceholder({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 120 52"
      preserveAspectRatio="none"
      className={className}
    >
      <line
        x1={0}
        x2={120}
        y1={26}
        y2={26}
        stroke="var(--fg-3)"
        strokeOpacity={0.18}
        strokeWidth={0.6}
        strokeDasharray="2 4"
      />
    </svg>
  );
}

/* ─────────────────────── math helpers ─────────────────────── */

/**
 * Catmull-Rom spline → cubic Bezier path string.
 */
function catmullRomToBezier(points: ReadonlyArray<[number, number]>): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const [x, y] = points[0]!;
    return `M${x.toFixed(2)},${y.toFixed(2)}`;
  }
  const [x0, y0] = points[0]!;
  let path = `M${x0.toFixed(2)},${y0.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    path += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return path;
}

function formatBannerPrice(n: number): string {
  if (n >= 1) {
    return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(6)}`;
}

/* ─────────────────────── TickerStack ─────────────────────── */

export interface TickerStackEntry {
  symbol: string;
  name?: string;
  price?: number;
  changePct?: number;
  history?: ReadonlyArray<number>;
}

/**
 * TickerStack — multi-ticker container.
 *
 * Behaviour:
 *   - 1 ticker  → single full TickerBanner (no chrome).
 *   - 2 tickers → full banners stacked (the answer is still readable
 *     below). No collapse needed.
 *   - 3+        → defaults to a COMPACT pill row so the chat answer
 *     doesn't get pushed below the fold on desktop or mobile. A
 *     wrap-toggle in the corner expands the row into full banners
 *     when the user wants the details.
 *
 * The toggle icon is a BarChart3 glyph (Lucide) — semantically "the
 * charts go here", not generic chevrons.
 */
export function TickerStack({
  entries,
  className,
}: {
  entries: ReadonlyArray<TickerStackEntry>;
  className?: string;
}) {
  // ≥3 tickers default to compact; user can flip to expanded.
  const [expanded, setExpanded] = useState<boolean>(() => entries.length <= 2);

  if (entries.length === 0) return null;

  // Auto-mode: 1-2 tickers always show full banners; the toggle UI
  // only appears for 3+ where space starts to matter.
  const showToggle = entries.length >= 3;

  if (!expanded && showToggle) {
    return (
      <div
        className={cn(
          // Match the assistant bubble's max width — keeps the stack
          // visually inside the same column as the chat content
          // instead of stretching edge-to-edge.
          'max-w-[42rem]',
          'relative overflow-hidden',
          'rounded-xl border border-[var(--border)]/70',
          'bg-[color-mix(in_oklab,var(--surface)_70%,transparent)]',
          'vz-bubble-in-left',
          className,
        )}
      >
        <div className="flex items-center gap-2 px-2 py-1.5 pr-10">
          <BarChart3
            size={13}
            strokeWidth={1.75}
            className="shrink-0 text-[var(--fg-3)] ml-1"
            aria-hidden
          />
          <ul className="flex flex-1 items-center gap-1.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {entries.map((entry) => (
              <li key={entry.symbol} className="shrink-0">
                <TickerPill {...entry} />
              </li>
            ))}
          </ul>
        </div>
        <StackToggle
          expanded={false}
          onClick={() => setExpanded(true)}
          count={entries.length}
        />
      </div>
    );
  }

  return (
    <div className={cn('max-w-[42rem] flex flex-col gap-2 relative', className)}>
      {entries.map((entry) => (
        <TickerBanner
          key={entry.symbol}
          symbol={entry.symbol}
          name={entry.name}
          price={entry.price}
          changePct={entry.changePct}
          history={entry.history}
        />
      ))}
      {showToggle && (
        <StackToggle
          expanded={true}
          onClick={() => setExpanded(false)}
          count={entries.length}
        />
      )}
    </div>
  );
}

/**
 * Floating expand/collapse toggle. Positioned at the top-right of
 * the stack so it never visually competes with the chart on the
 * right edge of the banners.
 */
function StackToggle({
  expanded,
  onClick,
  count,
}: {
  expanded: boolean;
  onClick: () => void;
  count: number;
}) {
  const Icon = expanded ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        expanded
          ? `Collapse ${count} tickers into a single row`
          : `Expand ${count} tickers into full cards`
      }
      title={expanded ? 'Collapse' : 'Expand'}
      className={cn(
        'absolute top-1.5 right-1.5 z-20',
        'inline-flex items-center justify-center',
        'h-6 w-6 rounded-full',
        'text-[var(--fg-3)] hover:text-[var(--fg)]',
        'bg-[color-mix(in_oklab,var(--surface)_85%,transparent)]',
        'hover:bg-[var(--surface-2)]',
        'border border-[var(--border)]/50',
        'transition-colors',
      )}
    >
      <Icon size={12} strokeWidth={2} aria-hidden />
    </button>
  );
}

/**
 * Compact pill — used inside TickerStack when collapsed. Same vocab
 * as the topic-bar ticker chips so the visual language stays
 * consistent across the predict surface.
 */
function TickerPill({
  symbol,
  price,
  changePct,
}: TickerStackEntry) {
  const upperSymbol = symbol.toUpperCase();
  const isUp = (changePct ?? 0) >= 0;
  const deltaPct = typeof changePct === 'number' ? changePct * 100 : null;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5',
        'h-7 px-2.5 rounded-full',
        'border border-[var(--border)]/60',
        'bg-[var(--surface)]',
      )}
    >
      <CoinIcon symbol={upperSymbol} size={14} />
      <span className="mono tabular text-[11px] font-semibold text-[var(--fg)]">
        {upperSymbol}
      </span>
      <span
        key={typeof price === 'number' ? price : 'na'}
        className="motion-safe:vz-price-tick mono tabular text-[11px] text-[var(--fg-2)]"
      >
        {typeof price === 'number' && price > 0 ? formatChipPrice(price) : '—'}
      </span>
      {deltaPct !== null && Number.isFinite(deltaPct) && (
        <span
          className="mono tabular text-[10px] font-semibold inline-flex items-center gap-0.5"
          style={{ color: isUp ? 'var(--up)' : 'var(--down)' }}
        >
          <span aria-hidden>{isUp ? '▲' : '▼'}</span>
          {Math.abs(deltaPct).toFixed(1)}%
        </span>
      )}
    </div>
  );
}

/** Tight price formatter for the compact pill row. */
function formatChipPrice(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(6)}`;
}
