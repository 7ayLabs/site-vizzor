/**
 * Custom iconography for the Predict surface.
 *
 * Each icon is a small SVG with a distinctive geometric form — characterful
 * but minimalist, monochromatic, sized to a 16×16 box and driven by
 * `currentColor`. They replace the generic line-icon set previously
 * imported from `lucide-react` so the chat surface has its own visual
 * vocabulary instead of looking like every Next.js admin panel.
 *
 * Convention:
 *   - All icons accept `size` (number, default 16) and `className`.
 *   - Stroke width is fixed at 1.6 for the line-style icons and 0 for
 *     the filled glyphs; this keeps optical weight consistent across
 *     the set when they sit side-by-side in a nav.
 *   - No emoji, no font glyphs — pure SVG so colour, size, and a11y
 *     are explicit.
 */
import type { SVGProps } from 'react';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
}

function base(size: number, props: Omit<IconProps, 'size'>): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...props,
  };
}

/* ─────────────────────── Primary navigation ─────────────────────── */

export function IconChat({ size = 16, ...props }: IconProps) {
  // Plain rounded speech-bubble outline. No inner dot, no asymmetry —
  // a quiet, geometric glyph that lets the active-state bg do the
  // work without competing for attention.
  return (
    <svg {...base(size, props)}>
      <path d="M3 4.5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6.5L4 13v-2.5a2 2 0 0 1-1-1.7V4.5Z" />
    </svg>
  );
}

export function IconPredict({ size = 16, ...props }: IconProps) {
  // A trending line that lifts into an arrowhead — directional, on-brand
  // for "make a call".
  return (
    <svg {...base(size, props)}>
      <path d="M2.5 11.5L6 8l2.5 2.5L13.5 5" />
      <path d="M10 5h3.5v3.5" />
    </svg>
  );
}

export function IconReceipts({ size = 16, ...props }: IconProps) {
  // A scroll-style document with a torn lower edge — reads as "audit trail"
  // / "receipt" rather than a generic file.
  return (
    <svg {...base(size, props)}>
      <path d="M3.5 2.5h7a1 1 0 0 1 1 1V12l-1.3-0.8-1.4 0.8-1.4-0.8-1.4 0.8-1.4-0.8L3.5 12V3.5a1 1 0 0 1 1-1Z" />
      <path d="M5.5 5.5h4" />
      <path d="M5.5 8h3" />
    </svg>
  );
}

export function IconHistory({ size = 16, ...props }: IconProps) {
  // Plain clock outline — 12 o'clock and hour hand at 4. Minimal,
  // matches the rest of the geometric set without the counter-
  // clockwise refresh tail.
  return (
    <svg {...base(size, props)}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" />
    </svg>
  );
}

export function IconTools({ size = 16, ...props }: IconProps) {
  // Plain three-line equalizer / menu. No knobs, no filled circles —
  // a quiet rule-of-three.
  return (
    <svg {...base(size, props)}>
      <path d="M2.5 4.5h11" />
      <path d="M2.5 8h11" />
      <path d="M2.5 11.5h11" />
    </svg>
  );
}

export function IconLibrary({ size = 16, ...props }: IconProps) {
  // Two stacked rectangles — a clean "ledger / collection" glyph
  // without the offset-book chrome.
  return (
    <svg {...base(size, props)}>
      <rect x="2.5" y="3" width="11" height="4" rx="1" />
      <rect x="2.5" y="9" width="11" height="4" rx="1" />
    </svg>
  );
}

export function IconSettings({ size = 16, ...props }: IconProps) {
  // Plain rounded square — "tile". No interior detail. Pairs with the
  // help circle as a balanced shape vocabulary at the sidebar bottom.
  return (
    <svg {...base(size, props)}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
    </svg>
  );
}

export function IconHelp({ size = 16, ...props }: IconProps) {
  // Plain circle. Pairs with the IconSettings square so the bottom of
  // the sidebar reads as a balanced two-shape pair (square + circle).
  return (
    <svg {...base(size, props)}>
      <circle cx="8" cy="8" r="5.5" />
    </svg>
  );
}

/* ─────────────────────── Quick actions ─────────────────────── */

export function IconWinRate({ size = 16, ...props }: IconProps) {
  // Three-quarter ring with an inner check — "scoreboard" read.
  return (
    <svg {...base(size, props)}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.8-4.1" />
      <path d="M5.6 8.4l1.6 1.7 3.4-3.9" />
    </svg>
  );
}

export function IconActivity({ size = 16, ...props }: IconProps) {
  // Heartbeat / pulse — reads as "live data" without being a stock chart.
  return (
    <svg {...base(size, props)}>
      <path d="M2.5 8h2l1.5-3.5L8.5 12l1.5-4 1 2h2.5" />
    </svg>
  );
}

export function IconPrice({ size = 16, ...props }: IconProps) {
  // Stacked candles — three vertical wicks with bodies of different
  // heights. Crypto-native shorthand for "price".
  return (
    <svg {...base(size, props)}>
      <path d="M4 3v10" />
      <rect x="3" y="5.5" width="2" height="5" rx="0.4" fill="currentColor" stroke="none" />
      <path d="M8 4v10" />
      <rect x="7" y="6" width="2" height="3.5" rx="0.4" fill="currentColor" stroke="none" />
      <path d="M12 3v10" />
      <rect x="11" y="4.5" width="2" height="6" rx="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSignal({ size = 16, ...props }: IconProps) {
  // Concentric arcs from a corner — "broadcast / signal" without being
  // a wifi glyph.
  return (
    <svg {...base(size, props)}>
      <circle cx="4" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <path d="M4 9a3 3 0 0 1 3 3" />
      <path d="M4 5.5a6.5 6.5 0 0 1 6.5 6.5" />
      <path d="M4 2a10 10 0 0 1 10 10" />
    </svg>
  );
}

/* ─────────────────────── Utility ─────────────────────── */

export function IconLock({ size = 16, ...props }: IconProps) {
  // Minimal lock — wider shackle so the silhouette reads at small sizes.
  return (
    <svg {...base(size, props)}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" />
      <circle cx="8" cy="10.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSearch({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3 3" />
    </svg>
  );
}

export function IconSparkle({ size = 16, ...props }: IconProps) {
  // Four-point starburst with a tiny accent — "spark / new".
  return (
    <svg {...base(size, props)}>
      <path d="M8 2.5v4M8 9.5v4M2.5 8h4M9.5 8h4" />
      <path d="M12 3l-1 1M5 11l-1 1M11 12l1 1M4 4l1 1" strokeWidth="1.2" />
    </svg>
  );
}

export function IconPaperclip({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M12 7.5L8 11.5a2.5 2.5 0 0 1-3.5-3.5L8.5 4a1.5 1.5 0 0 1 2 2L7 9.5" />
    </svg>
  );
}

export function IconSend({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.8 })}>
      <path d="M3 8l10-5.5L10.5 13 8 9 3 8Z" />
    </svg>
  );
}

export function IconPlus({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function IconMenu({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    </svg>
  );
}

export function IconClose({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function IconChevronRight({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

export function IconArrowUp({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 2 })}>
      <path d="M8 3v10M4 7l4-4 4 4" />
    </svg>
  );
}

export function IconArrowDown({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 2 })}>
      <path d="M8 3v10M4 9l4 4 4-4" />
    </svg>
  );
}

export function IconDot({ size = 8, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      fill="currentColor"
      aria-hidden
      {...props}
    >
      <circle cx="4" cy="4" r="3" />
    </svg>
  );
}

/**
 * Density toggle glyphs. `IconDensityComfortable` shows two thicker
 * rows spaced apart — the current "spacious" view. `IconDensityCompact`
 * shows three tighter rows packed together — the "more in view" mode.
 * Pair semantically: the button swaps icons based on the NEXT state
 * the user is heading toward, matching the ThemeToggle convention.
 */
export function IconDensityComfortable({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M3 5h10" />
      <path d="M3 11h10" />
    </svg>
  );
}

export function IconDensityCompact({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M3 4h10" />
      <path d="M3 8h10" />
      <path d="M3 12h10" />
    </svg>
  );
}

/**
 * Bell glyph for the alerts entry in the predict-shell left nav.
 * Matches the geometric line style of the rest of the predict-icons
 * set so it sits cleanly next to IconChat, IconReceipts, etc.
 */
export function IconBell({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M8 2.5v1" />
      <path d="M4 11.5V8a4 4 0 0 1 8 0v3.5" />
      <path d="M3 11.5h10" />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" />
    </svg>
  );
}
