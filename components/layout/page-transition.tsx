'use client';

/**
 * Page transition wrapper.
 *
 * Two behaviours layered on top of each other:
 *
 *   1. Re-keys on every pathname change so React unmounts the previous
 *      page tree and remounts the new one — triggering the CSS
 *      `page-transition-enter` animation defined in `app/globals.css`
 *      and mirrored into `app/docs/docs.css` (calm 220ms fade + 6px
 *      slide-up).
 *
 *   2. Shows the Vizzor brand-mark loader (`<VizzorLoader />`) for a
 *      minimum visibility window on every navigation. Next's native
 *      `loading.tsx` convention only fires when the new segment
 *      genuinely suspends; instant client-side swaps between
 *      pre-rendered pages would otherwise never surface the loader at
 *      all. The minimum window guarantees the user always gets a
 *      brand-shaped beat of feedback when they navigate.
 *
 * The initial page load *does not* show the loader — the user just
 * arrived; a loader at that moment would feel like a stall, not a
 * transition. We only show the loader between navigations.
 *
 * Reduced-motion users get the final state with no animation via the
 * existing media block in the stylesheet; the loader still mounts but
 * the brand-mark pulse and ring rotation collapse to a static frame.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { VizzorLoader } from './vizzor-loader';

/**
 * Minimum window the brand loader is on screen during navigation.
 * Tuned so the brand moment registers without feeling like a stall.
 * Match it with the longest individual leg of the loader animation
 * (~700ms covers one full inner-ring rotation + a pulse beat).
 */
const MIN_LOADER_MS = 700;

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const previousPathRef = useRef<string | null>(null);
  const [showLoader, setShowLoader] = useState(false);

  useEffect(() => {
    if (previousPathRef.current === null) {
      // Initial mount — record the path but never flash the loader on
      // the first page the user lands on.
      previousPathRef.current = pathname;
      return;
    }
    if (previousPathRef.current === pathname) return;

    setShowLoader(true);
    const id = window.setTimeout(() => {
      setShowLoader(false);
      previousPathRef.current = pathname;
    }, MIN_LOADER_MS);
    return () => window.clearTimeout(id);
  }, [pathname]);

  return (
    <>
      {showLoader && <VizzorLoader />}
      <div key={pathname} className="page-transition-enter">
        {children}
      </div>
    </>
  );
}
