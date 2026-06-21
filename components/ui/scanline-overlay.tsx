/**
 * ScanlineOverlay — absolute-positioned CRT scanline tint.
 *
 * Caller wraps a section/tile with `relative` and drops this inside.
 * Uses the `.vt-scanlines` utility, which is stripped under
 * `prefers-reduced-motion: reduce` (see globals.css), so reduced-motion
 * users see a clean surface — no JS gate needed here.
 *
 * Server-renderable.
 */
import { cn } from '@/lib/utils';

export interface ScanlineOverlayProps {
  /** Overlay opacity 0..1 — defaults to 1 (the utility already pre-tints). */
  opacity?: number;
  className?: string;
}

export function ScanlineOverlay({
  opacity = 1,
  className,
}: ScanlineOverlayProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'vt-scanlines absolute inset-0 z-0',
        className,
      )}
      style={{ opacity }}
    />
  );
}
