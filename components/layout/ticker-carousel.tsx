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
 */

import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import { CoinIcon } from '@/components/ui/coin-icon';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { getTicker } from '@/lib/snapshot';
import type { TickerEntry } from '@/lib/types';

interface TickerCarouselProps {
  entries?: TickerEntry[];
}

const DIVIDER_STYLE: CSSProperties = { height: '14px' };

function TickerPill({ entry }: { entry: TickerEntry }) {
  const positive = entry.changePct >= 0;
  return (
    <span className="flex items-center gap-2 px-4 whitespace-nowrap">
      <CoinIcon symbol={entry.symbol} size={16} />
      <span className="mono tabular text-[11px] text-[var(--fg-3)]">
        {entry.symbol}
      </span>
      <span className="mono tabular text-[12px] text-[var(--fg)]">
        <AnimatedNumber value={entry.price} format="usd" duration={500} />
      </span>
      <span
        className="mono tabular text-[11px]"
        style={{ color: positive ? 'var(--accent)' : 'var(--danger)' }}
      >
        <AnimatedNumber
          value={entry.changePct * 100}
          format="pct"
          duration={500}
          decimals={2}
          prefix={positive ? '+' : ''}
        />
      </span>
      <span
        aria-hidden
        className="ml-2 inline-block w-px bg-[var(--border)] align-middle"
        style={DIVIDER_STYLE}
      />
    </span>
  );
}

export function TickerCarousel({ entries }: TickerCarouselProps) {
  const t = useTranslations('ticker');
  const data = entries && entries.length > 0 ? entries : getTicker();

  return (
    <div
      role="marquee"
      aria-label={t('ariaLabel')}
      className="
        relative w-full overflow-hidden
        border-b border-[var(--border)]
        bg-[var(--surface)]
        h-8 sm:h-9
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
