/**
 * TrustBecauseTrackedClient — owns the dynamic-imported `<RibbonHeat>`
 * background.
 *
 * R3F can only be code-split with `dynamic(..., { ssr: false })` inside
 * a client component, so the import sits here. The component renders a
 * pointer-events:none ribbon at ~20% opacity behind the rest of the
 * section. RibbonHeat handles its own reduced-motion fallback (static
 * SVG smooth wave) — we just pass through `wr`.
 */
'use client';

import dynamic from 'next/dynamic';

const RibbonHeat = dynamic(
  () =>
    import('@/components/three/ribbon-heat').then((m) => ({
      default: m.RibbonHeat,
    })),
  { ssr: false },
);

export interface TrustRibbonBackgroundProps {
  wr: number;
  height?: number;
}

export function TrustRibbonBackground({
  wr,
  height = 400,
}: TrustRibbonBackgroundProps) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center"
      style={{ opacity: 0.2 }}
    >
      <div className="w-full" style={{ maxHeight: height }}>
        <RibbonHeat wr={wr} height={height} />
      </div>
    </div>
  );
}
