'use client';

/**
 * InlineTickerChip — compact ticker affordance rendered inline with the
 * "VIZZOR · HH:MM:SS" header on each assistant turn.
 *
 * Replaces the wide `TickerStack` card that used to render between the
 * user bubble and the assistant response. The wide card was being read
 * as "Vizzor's prediction" when it's actually just the live price — the
 * inline chip is direction-tinted but visually subordinate to the
 * response itself, which removes the confusion.
 *
 * Sizing mirrors the header it sits next to: 9.5px monospace, low
 * opacity, no border so it reads as metadata rather than a content card.
 *
 * Icon contract: the coin logo CDN can 404 on long-tail tokens (DASH,
 * LINK, …). When that happens we drop the icon entirely instead of
 * showing a duplicate-of-the-symbol monogram next to the symbol label.
 * The chip still carries SYMBOL · $price · ▼/▲ pct — the user gets
 * everything that matters even without the logo.
 */

import { useState } from 'react';
import Image from 'next/image';
import { coinIconUrl, TOP_20_BY_SYMBOL } from '@/lib/coin-meta';
import { cn } from '@/lib/utils';

export interface InlineTickerChipEntry {
  symbol: string;
  price?: number;
  changePct?: number;
}

export function InlineTickerChip({
  symbol,
  price,
  changePct,
  className,
}: InlineTickerChipEntry & { className?: string }) {
  const upperSymbol = symbol.toUpperCase();
  const isUp = (changePct ?? 0) >= 0;
  const deltaPct = typeof changePct === 'number' ? changePct * 100 : null;
  const [iconFailed, setIconFailed] = useState(false);
  const meta = TOP_20_BY_SYMBOL[upperSymbol];
  const iconKey = meta?.iconKey ?? upperSymbol.toLowerCase();

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 align-middle',
        // 70% opacity baseline matches the muted header tokens and keeps
        // the chip clearly subordinate to the response body.
        'opacity-70',
        className,
      )}
    >
      {!iconFailed && (
        <Image
          src={coinIconUrl(iconKey)}
          alt=""
          width={12}
          height={12}
          unoptimized
          onError={() => setIconFailed(true)}
          className="inline-block shrink-0 rounded-full"
        />
      )}
      <span className="mono tabular text-[9.5px] font-semibold text-[var(--fg-2)]">
        {upperSymbol}
      </span>
      {typeof price === 'number' && price > 0 && (
        <span
          key={price}
          className="motion-safe:vz-price-tick mono tabular text-[9.5px] text-[var(--fg-2)] normal-case"
        >
          {formatInlinePrice(price)}
        </span>
      )}
      {deltaPct !== null && Number.isFinite(deltaPct) && (
        <span
          className="mono tabular text-[9.5px] font-semibold inline-flex items-center gap-0.5 normal-case"
          style={{ color: isUp ? 'var(--up)' : 'var(--down)' }}
        >
          <span aria-hidden>{isUp ? '▲' : '▼'}</span>
          {Math.abs(deltaPct).toFixed(2)}%
        </span>
      )}
    </span>
  );
}

export function InlineTickerChipGroup({
  entries,
  className,
}: {
  entries: ReadonlyArray<InlineTickerChipEntry>;
  className?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {entries.map((entry) => (
        <InlineTickerChip key={entry.symbol} {...entry} />
      ))}
    </span>
  );
}

function formatInlinePrice(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(6)}`;
}
