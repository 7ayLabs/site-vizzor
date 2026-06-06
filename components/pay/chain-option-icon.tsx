'use client';

/**
 * ChainOptionIcon — composite mark used in the chain selector and
 * order summary header. For native rails (SOL, TON) it renders only
 * the chain mark. For USDC rails (Base, Arbitrum) it renders the
 * USDC mark as the primary and a small network badge in the lower
 * right so the user reads the asset first and the underlying L2 second.
 */

import { ChainIcon, type ChainIconId } from './chain-icons';

interface ChainOptionIconProps {
  primary: ChainIconId;
  networkBadge?: ChainIconId;
  active?: boolean;
  size?: number;
}

export function ChainOptionIcon({
  primary,
  networkBadge,
  active = false,
  size = 40,
}: ChainOptionIconProps) {
  return (
    <span
      aria-hidden
      className={`
        group/icon relative flex shrink-0 items-center justify-center
        rounded-xl overflow-visible
        transition-transform duration-200 ease-out
        motion-safe:group-hover:scale-[1.06]
        ${active ? 'motion-safe:scale-[1.04]' : ''}
      `}
      style={{ height: size, width: size }}
    >
      <ChainIcon id={primary} size={Math.round(size * 0.9)} />
      {networkBadge && (
        <span
          className="
            absolute -bottom-1 -right-1
            flex items-center justify-center
            rounded-full
            ring-2 ring-[var(--surface)]
            bg-[var(--surface)]
            transition-transform duration-200 ease-out
            motion-safe:group-hover/icon:scale-110
          "
          style={{
            height: Math.max(16, Math.round(size * 0.42)),
            width: Math.max(16, Math.round(size * 0.42)),
          }}
        >
          <ChainIcon
            id={networkBadge}
            size={Math.max(12, Math.round(size * 0.36))}
          />
        </span>
      )}
    </span>
  );
}
