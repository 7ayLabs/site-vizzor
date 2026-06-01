/**
 * Design tokens — the single source of truth for vizzor.ai colors.
 *
 * Light is canonical. Dark inverts surfaces and recalibrates accent saturation.
 * Tokens are surfaced as CSS variables in `app/globals.css`; this file exists
 * so TS can typecheck against the token names and so we have one place to edit.
 *
 * Brand color rationale: emerald (not the predictable purple-blue of AI/crypto
 * sites) keeps Vizzor visually distinct. Gold + whale-blue map directly to the
 * 🌟 high-conviction and 🐋 whale-confirmed emoji tiers from the product.
 */

export const lightTokens = {
  '--bg': '#FAFAF7',
  '--surface': '#FFFFFF',
  '--surface-2': '#F5F4EF',
  '--border': '#E8E7E0',
  '--fg': '#0A0A0A',
  '--fg-2': '#52525B',
  '--fg-3': '#737373',
  '--accent': '#10B981',
  '--accent-fg': '#022C20',
  '--danger': '#DC2626',
  '--gold': '#F59E0B',
  '--whale': '#3B82F6',
  '--code-bg': '#0A0A0A',
  '--code-fg': '#E8E8E8',
} as const;

export const darkTokens = {
  '--bg': '#0A0A0B',
  '--surface': '#111114',
  '--surface-2': '#17171B',
  '--border': '#23232A',
  '--fg': '#F5F5F2',
  '--fg-2': '#A1A1AA',
  '--fg-3': '#71717A',
  '--accent': '#34D399',
  '--accent-fg': '#022C20',
  '--danger': '#F87171',
  '--gold': '#FBBF24',
  '--whale': '#60A5FA',
  '--code-bg': '#000000',
  '--code-fg': '#E8E8E8',
} as const;

export type TokenName = keyof typeof lightTokens;

export const tierColor = {
  'high-conviction': 'var(--gold)',
  'whale-confirmed': 'var(--whale)',
  tracked: 'var(--accent)',
  advisory: 'var(--fg-3)',
} as const;

export const tierEmoji = {
  'high-conviction': '🌟',
  'whale-confirmed': '🐋',
  tracked: '✅',
  advisory: '⚪',
} as const;

export const tierLabel = {
  'high-conviction': 'high-conviction',
  'whale-confirmed': 'whale-confirmed',
  tracked: 'tracked',
  advisory: 'advisory',
} as const;
