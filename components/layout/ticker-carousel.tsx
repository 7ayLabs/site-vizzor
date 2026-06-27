'use client';

/**
 * Top-of-page infinite scrolling ticker carousel.
 *
 * Renders a single-line horizontal marquee of top-20 crypto symbols with logos,
 * prices, and 24h delta. Continuously scrolls right-to-left at a steady cadence;
 * pauses on hover. Each price/delta cell tweens via <AnimatedNumber> whenever
 * the upstream value changes, so live updates feel kinetic rather than abrupt.
 *
 * Seamless-loop trick: we render the entry list TWICE inside the same flex
 * track and translate the track by -50%. When copy #1 reaches the offscreen
 * edge, copy #2 has rotated into copy #1's original position — the loop has
 * no visible seam. The second copy is aria-hidden so screen readers don't
 * double-announce the data.
 *
 * Edge fades and a fixed LIVE pill sit above the track via z-index so the
 * scroll doesn't pop entries in/out of the user's peripheral vision.
 *
 * prefers-reduced-motion freezes the marquee via .marquee-track's media rule
 * in globals.css.
 *
 * On hover, each pill surfaces a small action menu:
 *   - "Predict {SYMBOL}" — deep-links the visitor into the Telegram bot
 *     with a pre-filled /start payload so the conversation lands on the
 *     prediction flow for that symbol.
 *   - "Auto-trade {SYMBOL}" — disabled, badged "Coming soon". The
 *     autonomous execution surface is on the roadmap; the visible
 *     placeholder pre-signals it without making a clickable promise.
 */

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CoinIcon } from '@/components/ui/coin-icon';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Link } from '@/i18n/navigation';
import { useTicker } from '@/lib/api';
import { getTicker } from '@/lib/snapshot';
import type { TickerEntry } from '@/lib/types';

interface TickerCarouselProps {
  entries?: TickerEntry[];
}

function TickerPill({ entry }: { entry: TickerEntry }) {
  const t = useTranslations('ticker');
  const [open, setOpen] = useState(false);
  const positive = entry.changePct >= 0;
  const directionColor = positive ? 'var(--up)' : 'var(--down)';

  // Deep-link into the web Predict surface with the symbol pre-selected.
  // The composer on `/app/predict` can read `?asset=` to pre-fill the
  // ticker context (follow-up if it doesn't yet). Locale-aware Link so
  // /es and /fr visitors stay inside their language. Href is constructed
  // inline below using next-intl's object form so the query string types
  // cleanly under typedRoutes without an `as never` escape hatch.

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/* Each entry is a refined chip: hover lifts a subtle pill
          backdrop without disrupting the marquee flow. Wider gap
          between chips (mx-1) replaces the prior vertical divider. */}
      <span
        className="
          flex items-center gap-2.5
          h-7 px-3 mx-1
          rounded-full
          whitespace-nowrap cursor-default
          transition-colors duration-150 ease-out
          hover:bg-[color-mix(in_oklab,var(--fg)_5%,transparent)]
        "
      >
        <CoinIcon symbol={entry.symbol} size={16} />
        <span className="mono tabular text-[11px] font-semibold tracking-[0.04em] text-[var(--fg-2)] uppercase">
          {entry.symbol}
        </span>
        <span className="mono tabular text-[12px] text-[var(--fg)] tracking-tight">
          <AnimatedNumber value={entry.price} format="usd" duration={500} />
        </span>
        {/* Delta chip — small rounded pill with a very subtle direction
            tint so the up/down state reads at a glance without the
            entire ticker turning red on a bad day. */}
        <span
          className="
            mono tabular text-[10px] font-semibold
            inline-flex items-center gap-0.5
            h-[18px] px-1.5
            rounded-full
            tracking-tight
          "
          style={{
            color: directionColor,
            backgroundColor: `color-mix(in oklab, ${directionColor} 12%, transparent)`,
          }}
        >
          {/* ▲ / ▼ glyph — direction redundancy for colorblind users
              and high-contrast modes where the up/down tint flattens. */}
          <span aria-hidden className="text-[8px] leading-none">
            {positive ? '▲' : '▼'}
          </span>
          <AnimatedNumber
            value={entry.changePct * 100}
            format="pct"
            duration={500}
            decimals={2}
            prefix={positive ? '+' : ''}
          />
        </span>
      </span>

      {open && (
        // Outer wrapper carries an invisible pt-1.5 bridge so the cursor
        // can travel from the pill bottom into the menu without crossing
        // a hover-gap that would fire mouseleave on the parent span.
        <div
          className="absolute left-1/2 top-full z-50 -translate-x-1/2 pt-1.5"
        >
          <div
            role="menu"
            aria-label={`${entry.symbol} actions`}
            className="
              rounded-xl border border-[var(--border)] bg-[var(--surface)]
              shadow-[0_8px_24px_-12px_color-mix(in_oklab,var(--fg)_30%,transparent)]
              whitespace-nowrap overflow-hidden
            "
          >
            <Link
              role="menuitem"
              href={{
                pathname: '/app/predict',
                query: { asset: entry.symbol },
              }}
              className="
                block px-3.5 py-2 mono tabular text-[10.5px]
                uppercase tracking-[0.14em] text-[var(--fg)]
                hover:bg-[var(--surface-2)]
                transition-colors
              "
            >
              {t('predict', { symbol: entry.symbol })}
            </Link>
            <div
              role="menuitem"
              aria-disabled="true"
              className="
                flex items-center gap-2 border-t border-[var(--border)]
                px-3.5 py-2 mono tabular text-[10.5px]
                uppercase tracking-[0.14em] text-[var(--fg-3)]
                cursor-not-allowed select-none
              "
            >
              <span>{t('autoTrade', { symbol: entry.symbol })}</span>
              <span aria-hidden className="opacity-50">·</span>
              <span>{t('comingSoon')}</span>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}

export function TickerCarousel({ entries }: TickerCarouselProps) {
  const t = useTranslations('ticker');
  // SSR seed comes from the snapshot (passed via props by the server
  // wrapper). Once hydrated, SWR pulls live prices from /api/ticker
  // every 30s and the component re-renders with kinetic tweens.
  const live = useTicker(30_000);
  const data =
    live.data && live.data.length > 0
      ? live.data
      : entries && entries.length > 0
        ? entries
        : getTicker();

  return (
    // `overflow-x-clip` (NOT `hidden`) is the key: per CSS spec, `clip`
    // can coexist with `visible` on the other axis without auto-promoting.
    // Using `hidden` would silently force overflow-y to `auto`, clipping
    // the hover dropdown that escapes below the bar.
    <div
      role="marquee"
      aria-label={t('ariaLabel')}
      className="
        relative z-50 w-full
        border-b border-[var(--border)]
        bg-[var(--surface)]
        h-10 sm:h-11
        overflow-x-clip overflow-y-visible
      "
    >
      {/* Scrolling track — duplicated content for seamless wrap. */}
      <div className="marquee-track flex h-full w-max items-center">
        <div className="flex h-full items-center" aria-label="ticker entries">
          {data.map((entry) => (
            <TickerPill key={`a-${entry.symbol}`} entry={entry} />
          ))}
        </div>
        <div className="flex h-full items-center" aria-hidden="true">
          {data.map((entry) => (
            <TickerPill key={`b-${entry.symbol}`} entry={entry} />
          ))}
        </div>
      </div>

      {/* Left edge fade. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-6 z-[1]"
        style={{
          background:
            'linear-gradient(to right, var(--surface), transparent)',
        }}
      />

      {/* Right edge fade. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-6 z-[1]"
        style={{
          background:
            'linear-gradient(to left, var(--surface), transparent)',
        }}
      />
    </div>
  );
}
