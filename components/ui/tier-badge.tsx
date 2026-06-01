/**
 * TierBadge — small pill rendering a Vizzor signal tier (high-conviction /
 * whale-confirmed / tracked / advisory) as colored border + emoji + uppercase
 * eyebrow label. The only place in the codebase where decorative emoji is
 * permitted; tier-color comes from @/lib/tokens.
 */

import { cn } from '@/lib/utils';
import { tierColor, tierEmoji, tierLabel } from '@/lib/tokens';
import type { Tier } from '@/lib/types';

export interface TierBadgeProps {
  tier: Tier;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export function TierBadge({ tier, size = 'md', showLabel = true }: TierBadgeProps) {
  const color = tierColor[tier];
  const emoji = tierEmoji[tier];
  const label = tierLabel[tier];

  const isSm = size === 'sm';

  return (
    <span
      role="status"
      aria-label={`Tier: ${label}`}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full',
        'border bg-transparent dark:bg-[var(--surface)]',
        'transition-colors duration-150',
        isSm ? 'h-[18px] px-1.5 text-[9px]' : 'h-6 px-2 text-[10px]',
      )}
      style={{
        borderColor: color,
        color,
      }}
    >
      <span aria-hidden className={cn('leading-none', isSm ? 'text-[10px]' : 'text-[12px]')}>
        {emoji}
      </span>
      {showLabel && (
        <span
          className={cn(
            'font-semibold uppercase tracking-[0.14em] leading-none',
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
