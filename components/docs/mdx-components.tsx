/**
 * MDX component re-exports for the /docs zone.
 *
 * Acts as a single, stable import surface for every MDX file —
 * `<TerminalBlock>`, `<TierBadge>`, etc. resolve to the existing site
 * design-system atoms under `components/ui/*`. The Fumadocs `<DocsBody>`
 * registers these via the `components` prop in `app/docs/[[...slug]]/page.tsx`.
 */

export { TerminalBlock } from '@/components/ui/terminal-block';
export { TierBadge } from '@/components/ui/tier-badge';
export { DataTile } from '@/components/ui/data-tile';
export { SignalRow } from '@/components/ui/signal-row';
export { ChainPill } from '@/components/ui/chain-pill';
export { CoinIcon } from '@/components/ui/coin-icon';
export { ChainIcon } from '@/components/ui/chain-icon';
export { CopyChip } from '@/components/ui/copy-chip';
