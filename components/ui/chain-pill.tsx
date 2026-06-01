/**
 * ChainPill — compact chain identifier rendered as a glyph + label pill.
 * Glyphs are deliberate single-character marks (not SVG) so a row of pills
 * stays lightweight and visually quiet. Glyph color is split between accent
 * (ethereum/base) and whale-blue (everything else) to give the L1/L2 chains
 * a slight visual hierarchy without resorting to per-chain rainbow colors.
 */

import { cn } from '@/lib/utils';
import type { Chain } from '@/lib/types';

export interface ChainPillProps {
  chain: Chain;
  size?: 'xs' | 'sm';
  showLabel?: boolean;
}

const CHAIN_GLYPH: Record<Chain, string> = {
  ethereum: '⟠',
  polygon: '⬢',
  arbitrum: '◈',
  optimism: '○',
  base: '▣',
  bsc: '◆',
  avalanche: '▲',
  solana: '◎',
  sui: '≋',
  aptos: '▾',
  ton: '◐',
};

const CHAIN_LABEL: Record<Chain, string> = {
  ethereum: 'Ethereum',
  polygon: 'Polygon',
  arbitrum: 'Arbitrum',
  optimism: 'Optimism',
  base: 'Base',
  bsc: 'BSC',
  avalanche: 'Avalanche',
  solana: 'Solana',
  sui: 'Sui',
  aptos: 'Aptos',
  ton: 'TON',
};

function glyphColor(chain: Chain): string {
  if (chain === 'ethereum' || chain === 'base') return 'var(--accent)';
  return 'var(--whale)';
}

export function ChainPill({ chain, size = 'sm', showLabel = true }: ChainPillProps) {
  const glyph = CHAIN_GLYPH[chain];
  const label = CHAIN_LABEL[chain];
  const isXs = size === 'xs';

  return (
    <span
      role="img"
      aria-label={`Chain: ${label}`}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full',
        'border border-[var(--border)] bg-[var(--surface-2)]',
        'transition-colors duration-150',
        isXs ? 'h-[18px] px-1.5 text-[9px]' : 'h-[22px] px-2 text-[10px]',
      )}
    >
      <span
        aria-hidden
        className={cn('leading-none', isXs ? 'text-[10px]' : 'text-[12px]')}
        style={{ color: glyphColor(chain) }}
      >
        {glyph}
      </span>
      {showLabel && (
        <span className="font-medium tracking-[0.04em] leading-none text-[var(--fg-2)]">
          {label}
        </span>
      )}
    </span>
  );
}
