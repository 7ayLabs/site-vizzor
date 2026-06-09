/**
 * lib/motion — reduced-motion gate + canonical GSAP reveal helper.
 *
 * Centralizes the `prefers-reduced-motion` detection so every animated
 * primitive (GSAP timelines, R3F canvases, decorative CSS keyframes)
 * shares one source of truth. If JS-state ever drifts from the media
 * query the user pays the cost — they cannot opt back in via toggling
 * a flag at runtime. This is enforced by re-reading the media query at
 * effect time rather than caching it in module scope.
 *
 * GSAP + ScrollTrigger imports mirror the pattern in `gsap-headline.tsx`
 * (default `gsap` export). ScrollTrigger is loaded lazily inside
 * `runGsapReveal` so callers that never invoke it don't pay the bundle.
 */
'use client';

import { useEffect, useState } from 'react';
import gsap from 'gsap';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * useReducedMotionSafe — returns true if user prefers reduced motion OR
 * if we cannot determine (SSR / older browsers without matchMedia).
 *
 * Use this as the kill-switch for GSAP timelines, R3F canvases, and any
 * decorative CSS animation. The hook subscribes to media-query changes
 * so themes that switch reduced-motion mid-session settle correctly.
 */
export function useReducedMotionSafe(): boolean {
  const [reduced, setReduced] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      setReduced(true);
      return;
    }
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    setReduced(mq.matches);
    const handler = (event: MediaQueryListEvent): void => {
      setReduced(event.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return reduced;
}

export interface GsapRevealOptions {
  /** The element ScrollTrigger pins / watches for entry. */
  root: HTMLElement;
  /** The elements that will animate from (opacity 0, y 16) -> (1, 0). */
  targets: readonly HTMLElement[];
  /** Caller-resolved reduced-motion gate; pass the hook result. */
  reduced: boolean;
  /**
   * Per-target stagger in seconds — defaults to 0.06. Set to 0 for a
   * single-shot reveal of one target.
   */
  stagger?: number;
  /** Total duration per target in seconds — defaults to 0.5. */
  duration?: number;
}

/**
 * runGsapReveal — single source of truth for section reveal timelines.
 *
 * Caller passes a root element + the elements to animate. If reduced
 * motion is enabled, snaps targets to final state instantly and returns
 * a no-op cleanup. Otherwise builds a one-shot IntersectionObserver-
 * triggered GSAP timeline (no ScrollTrigger plugin — keeps the bundle
 * lean and avoids the "scroll-y replay loop" anti-pattern; same
 * approach used in `gsap-headline.tsx`).
 *
 * ALWAYS call the returned cleanup function in your `useEffect` return.
 */
export function runGsapReveal(opts: GsapRevealOptions): () => void {
  const { root, targets, reduced, stagger = 0.06, duration = 0.5 } = opts;

  if (targets.length === 0) {
    return () => {};
  }

  // Initial state is set in both branches so a reduced-motion user
  // never sees a flash of the pre-reveal offset.
  gsap.set(targets as HTMLElement[], { opacity: 0, y: 16 });

  if (reduced) {
    gsap.set(targets as HTMLElement[], { opacity: 1, y: 0 });
    return () => {};
  }

  let played = false;
  const play = (): void => {
    if (played) return;
    played = true;
    gsap.to(targets as HTMLElement[], {
      opacity: 1,
      y: 0,
      duration,
      ease: 'power3.out',
      stagger,
    });
  };

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          play();
          io.unobserve(entry.target);
          break;
        }
      }
    },
    { threshold: 0.08, rootMargin: '0px 0px -5% 0px' },
  );
  io.observe(root);

  return () => {
    io.disconnect();
  };
}
