/**
 * TelegramIcon — inline brand-mark SVG.
 *
 * The chrome's "Open in Telegram" CTA used to render a generic
 * right-arrow (header) or Lucide `ArrowUpRight` (mobile drawer).
 * Both read as "external link" not "Telegram". The official
 * paper-plane glyph carries the brand association the CTA needs.
 *
 * Single solid path with `fill="currentColor"` so the theme system
 * controls the colour, and `stroke="none"` so no browser tries to
 * outline it. The path is the Telegram brand mark's paper-plane
 * silhouette (curved leading edge + angular trailing fold). Total
 * payload ~280 bytes — cheaper than a `lucide-react` import.
 *
 * Footer's Lucide `Send` swap to this icon is deferred to a
 * follow-up — out of scope for this pass.
 */

interface TelegramIconProps {
  /** Pixel size of the rendered square. Default 14, matching the
   *  ArrowUpRight the mobile drawer was using before. */
  size?: number;
  className?: string;
}

export function TelegramIcon({ size = 14, className }: TelegramIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden
      className={className}
    >
      <path d="M21.94 4.05c.14-.61-.51-1.13-1.07-.86L2.95 11.4c-.55.26-.51 1.05.07 1.25l4.16 1.43 1.59 5.13c.18.59.92.74 1.31.27l2.5-3.04 4.85 3.59c.51.38 1.25.09 1.37-.55l3.14-14.43z" />
    </svg>
  );
}
