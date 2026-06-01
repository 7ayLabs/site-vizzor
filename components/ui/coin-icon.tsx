'use client';

/**
 * <CoinIcon symbol="BTC" size={20} /> — round logo for a coin.
 *
 * Loads from CoinCap CDN. If the image fails, falls back to a monogram
 * tile (first 1-2 letters) styled in the brand. This keeps layout stable
 * even when the CDN 404s on obscure symbols.
 */

import { useState } from 'react';
import Image from 'next/image';
import { TOP_20_BY_SYMBOL, coinIconUrl } from '@/lib/coin-meta';

interface CoinIconProps {
  symbol: string;
  size?: number;
  className?: string;
}

export function CoinIcon({ symbol, size = 20, className }: CoinIconProps) {
  const [failed, setFailed] = useState(false);
  const meta = TOP_20_BY_SYMBOL[symbol];
  const key = meta?.iconKey ?? symbol.toLowerCase();
  const initials = symbol.slice(0, symbol.length <= 4 ? symbol.length : 3);

  if (failed) {
    return (
      <span
        aria-label={`${symbol} logo`}
        style={{ width: size, height: size, fontSize: size * 0.42 }}
        className={`
          inline-flex shrink-0 items-center justify-center rounded-full
          border border-[var(--border)] bg-[var(--surface-2)]
          mono tabular font-semibold text-[var(--fg-2)]
          ${className ?? ''}
        `}
      >
        {initials}
      </span>
    );
  }

  return (
    <Image
      src={coinIconUrl(key)}
      alt={`${symbol} logo`}
      width={size}
      height={size}
      unoptimized
      onError={() => setFailed(true)}
      className={`inline-block shrink-0 rounded-full ${className ?? ''}`}
      style={{ width: size, height: size }}
    />
  );
}
