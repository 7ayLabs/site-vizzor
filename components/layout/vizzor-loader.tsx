/**
 * VizzorLoader — full-page brand-mark loader shown during route transitions.
 *
 * Surfaces via Next.js App Router's `loading.tsx` convention. When a
 * route segment server-renders, Next shows the closest `loading.tsx`
 * until the segment is ready; placing it here means every navigation
 * gets a calm, on-brand interstitial instead of a blank flash.
 *
 * Visual: the Vizzor brand mark pulses (scale + opacity) inside a
 * subtle ring that rotates. Both effects loop while the loader is
 * mounted, then unmount cleanly when Next swaps in the new page.
 *
 * Strict B&W discipline — same brand-mark PNG swap used by the header
 * (light / dark variants), no separate icon, no spinner glyph.
 * Reduced-motion users get a static brand mark via the global
 * prefers-reduced-motion block in globals.css / docs.css.
 */

import Image from 'next/image';

export function VizzorLoader() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="
        fixed inset-0 z-50 flex items-center justify-center
        bg-[var(--bg)]/85 backdrop-blur-sm
      "
    >
      <div className="relative flex flex-col items-center gap-6">
        {/* Rotating ring + pulsing brand mark */}
        <div className="relative inline-flex h-20 w-20 items-center justify-center">
          {/* Outer rotating ring */}
          <span
            aria-hidden
            className="
              absolute inset-0 rounded-full
              border border-[var(--border)]
              vizzor-loader-spin
            "
          />
          {/* Inner ring with one accented arc — establishes rotation direction */}
          <span
            aria-hidden
            className="
              absolute inset-1 rounded-full
              border border-transparent
              vizzor-loader-spin-fast
            "
            style={{
              borderTopColor: 'var(--fg)',
              borderRightColor: 'color-mix(in oklab, var(--fg) 30%, transparent)',
            }}
          />
          {/* Brand mark — pulses inside the ring, two PNGs swapped by theme */}
          <span className="relative inline-flex h-10 w-10 items-center justify-center vizzor-loader-pulse">
            <Image
              src="/brand/vizzor_darkicon.png"
              alt=""
              width={364}
              height={535}
              priority
              className="block dark:hidden h-7 w-auto"
            />
            <Image
              src="/brand/vizzor_icon.png"
              alt=""
              width={364}
              height={535}
              priority
              className="hidden dark:block h-7 w-auto"
            />
          </span>
        </div>
        <p className="mono tabular text-[10.5px] uppercase tracking-[0.22em] text-[var(--fg-3)]">
          Loading
        </p>
      </div>
    </div>
  );
}
