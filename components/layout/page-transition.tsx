'use client';

/**
 * Page transition wrapper.
 *
 * The brand-mark loader (`<VizzorLoader />`) is shown:
 *
 *   1. On the **first paint** of every fresh visit — the loader is part
 *      of the initial SSR HTML (initial useState value is `true`), so
 *      it appears the moment the browser parses the document, *before*
 *      React has hydrated. This covers slow-network first-loads: the
 *      user sees the brand mark immediately and the rest of the page
 *      builds up behind it.
 *
 *   2. On **every subsequent navigation** for at least `MIN_LOADER_MS`.
 *      Next.js's native `loading.tsx` convention only kicks in for
 *      segments that genuinely suspend; instant client-side swaps would
 *      otherwise never surface a loader. The minimum window guarantees
 *      a brand-shaped beat of feedback on every nav, and the loader
 *      stays on top until both (a) the timer expires AND (b) the new
 *      page has rendered underneath — so slow networks keep the loader
 *      visible for longer naturally.
 *
 * The `<div key={pathname}>` triggers the `page-transition-enter`
 * fade + slide-up the moment the loader hides. Reduced-motion users
 * get the static frame via the existing media block in the stylesheet.
 *
 * sessionStorage carries the last visited path across cross-layout
 * navigations (the marketing zone and the docs zone have independent
 * root layouts, so an in-memory ref alone wouldn't survive). It's
 * currently only used to record visits — every mount / nav shows the
 * loader regardless — but the persistence layer is in place for any
 * future logic that wants to differentiate first-vs-subsequent visits.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { VizzorLoader } from './vizzor-loader';

/**
 * Minimum window the brand loader is on screen during navigation.
 * Tuned so the brand moment registers without feeling like a stall.
 * 700ms covers one full inner-ring rotation + a pulse beat.
 */
const MIN_LOADER_MS = 700;

const STORAGE_KEY = 'vizzor.nav.lastPath';

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
  // Default to `true` so the loader is part of the SSR HTML. Browsers
  // paint it before React hydrates — the brand mark is on screen the
  // moment the document parses, which is what makes slow-network
  // first-loads still feel branded.
  const [showLoader, setShowLoader] = useState(true);

  useEffect(() => {
    // Re-arm the loader on every mount and every path change. The
    // initial mount already had `showLoader=true` from useState, so
    // this just resets the timer to the new path; subsequent path
    // changes flip the loader back on for another full window.
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
