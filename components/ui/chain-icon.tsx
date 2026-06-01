'use client';

/**
 * <ChainIcon chain="ethereum" size={16} /> — small logo for a blockchain.
 *
 * Loads from DeFiLlama's chain icon CDN. Falls back to a monogram tile
 * when the image fails, keeping layout stable.
 */

import { useState } from 'react';
import Image from 'next/image';
import { chainIconUrl } from '@/lib/coin-meta';
import type { Chain } from '@/lib/types';

interface ChainIconProps {
  chain: Chain | string;
  size?: number;
  className?: string;
}

export function ChainIcon({ chain, size = 16, className }: ChainIconProps) {
  const [failed, setFailed] = useState(false);
  const initial = chain.charAt(0).toUpperCase();

  if (failed) {
    return (
      <span
        aria-label={`${chain} chain`}
        style={{ width: size, height: size, fontSize: size * 0.5 }}
        className={`
          inline-flex shrink-0 items-center justify-center rounded-full
          border border-[var(--border)] bg-[var(--surface-2)]
          mono tabular font-semibold text-[var(--fg-2)]
          ${className ?? ''}
        `}
      >
        {initial}
      </span>
    );
  }

  return (
    <Image
      src={chainIconUrl(chain)}
      alt={`${chain} chain logo`}
      width={size}
      height={size}
      unoptimized
      onError={() => setFailed(true)}
      className={`inline-block shrink-0 rounded-full ${className ?? ''}`}
      style={{ width: size, height: size }}
    />
  );
}
