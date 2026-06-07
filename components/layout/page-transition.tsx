'use client';

/**
 * Page transition wrapper — two-phase choreography.
 *
 * The transition runs as `loading → revealing` with carefully
 * synchronised CSS so the user never sees an abrupt cut:
 *
 *   ── loading phase ──────────────────────────────────────────────
 *   Loader is fully opaque, brand mark spins + pulses, page content
 *   underneath is at `opacity: 0` (and slightly translated). On first
 *   visit this is the SSR initial state (the loader ships with the
 *   HTML, so it appears before React hydrates), making cold loads on
 *   slow networks feel branded.
 *
 *   ── revealing phase (begins at MIN_LOADER_MS) ──────────────────
 *   Loader receives the `vizzor-loader-leaving` class — fades out
 *   over LOADER_FADE_MS. *Simultaneously* the page content receives
 *   `page-reveal-active` — fades + slides up to its resting position
 *   over the same window. The eye reads it as a single "veil
 *   lifting" gesture rather than two stacked transitions.
 *
 *   ── idle phase (loader unmounts) ───────────────────────────────
 *   After the fade-out completes the loader is removed from the DOM
 *   so it doesn't trap focus or steal pointer events.
 *
 * Reduced-motion users see the final state instantly — the content
 * is `opacity: 1` from the start and no animations play. The brand
 * loader still mounts briefly so they get the same "something
 * happened" feedback, just statically.
 *
 * sessionStorage carries the last path across cross-layout navs
 * (marketing zone and docs zone have independent root layouts, so an
 * in-memory ref alone wouldn't survive). It's not consulted to
 * suppress the loader — every mount / nav still gets it — but is in
 * place for any future per-zone differentiation.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { VizzorLoader } from './vizzor-loader';

/** Minimum window the loader stays at full opacity. 700ms covers
 *  one full inner-ring rotation + a pulse beat. */
const MIN_LOADER_MS = 700;

/** How long the loader fade-out + content reveal animation runs.
 *  Match the keyframe durations in globals.css / docs.css. */
const LOADER_FADE_MS = 420;

const STORAGE_KEY = 'vizzor.nav.lastPath';

function writeLastPath(path: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, path);
  } catch {
    /* sessionStorage unavailable (private mode, quota) — degrade silently. */
  }
}

type Phase = 'loading' | 'revealing';

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // SSR initial state — the loader is visible, content is hidden.
  const [phase, setPhase] = useState<Phase>('loading');
  const [loaderMounted, setLoaderMounted] = useState(true);

  useEffect(() => {
    // Re-enter loading on every mount + every path change. Both timers
    // are stored locally so a fast subsequent nav cancels the previous
    // run cleanly.
    setPhase('loading');
    setLoaderMounted(true);

    const startReveal = window.setTimeout(() => {
      setPhase('revealing');
      writeLastPath(pathname);
    }, MIN_LOADER_MS);

    const unmountLoader = window.setTimeout(() => {
      setLoaderMounted(false);
    }, MIN_LOADER_MS + LOADER_FADE_MS);

    return () => {
      window.clearTimeout(startReveal);
      window.clearTimeout(unmountLoader);
    };
  }, [pathname]);

  return (
    <>
      {loaderMounted && (
        <div
          className={
            phase === 'revealing' ? 'vizzor-loader-leaving' : undefined
          }
        >
          <VizzorLoader />
        </div>
      )}
      <div
        key={pathname}
        className={
          phase === 'revealing' ? 'page-reveal-active' : 'page-reveal-loading'
        }
      >
        {children}
      </div>
    </>
  );
}
