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
 * Initial-load semantics — we never flash the loader on the page the
 * user first lands on. To distinguish "first session visit" from
 * "second mount after a cross-layout nav" we persist the last path in
 * `sessionStorage`. The marketing zone (`/[locale]/*`) and the docs
 * zone (`/docs/*`) have independent root layouts; navigating between
 * them unmounts the previous PageTransition instance entirely, so an
 * in-memory ref alone would treat the new mount as a fresh visit and
 * silently swallow the loader. sessionStorage is the survivor.
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

const STORAGE_KEY = 'vizzor.nav.lastPath';

function readLastPath(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLastPath(path: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, path);
  } catch {
    /* sessionStorage unavailable (private mode, quota) — degrade silently. */
  }
}

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Locks the "first useEffect run" so we never flash the loader at
  // initial render of this component instance, even when sessionStorage
  // already holds a different path from a previous tab navigation.
  const initialisedRef = useRef(false);
  const [showLoader, setShowLoader] = useState(false);

  useEffect(() => {
    const previous = readLastPath();

    // First effect run for this mount. Two cases:
    //   (a) sessionStorage is empty -> brand-new session. Record and
    //       skip the loader.
    //   (b) sessionStorage holds a path != current -> the user came
    //       from another layout (e.g. /pricing -> /docs/predictor).
    //       Treat as a navigation: show the loader.
    if (!initialisedRef.current) {
      initialisedRef.current = true;
      if (previous !== null && previous !== pathname) {
        setShowLoader(true);
        const id = window.setTimeout(() => {
          setShowLoader(false);
          writeLastPath(pathname);
        }, MIN_LOADER_MS);
        return () => window.clearTimeout(id);
      }
      writeLastPath(pathname);
      return;
    }

    // Subsequent runs — pathname changed within the same mount.
    if (previous === pathname) return;
    setShowLoader(true);
    const id = window.setTimeout(() => {
      setShowLoader(false);
      writeLastPath(pathname);
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
