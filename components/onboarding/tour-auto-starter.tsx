'use client';

/**
 * TourAutoStarter — fires the guided tour on the wallet's first
 * successful SIWS handshake per browser.
 *
 * Trigger rule (prod):
 *   1. `signedIn` transitions false → true (in-session, not a page-
 *      load where the user was already signed in).
 *   2. `hasCompletedTour()` returns false (no persistent flag).
 *   3. Wait `START_DELAY_MS` so the wallet-adapter close animation
 *      finishes cleanly before the spotlight paints.
 *   4. If we're not on `/app/predict`, route there first — the tour
 *      steps spotlight elements that only exist on the predict shell.
 *   5. Call `useTour().open()`.
 *
 * Dev-mode bypass (`process.env.NODE_ENV !== 'production'`):
 *   BOTH the transition gate AND the persistent flag gate are skipped
 *   so devs iterating on the tour see it on every login. The
 *   `firedRef` guard is preserved so the tour only opens once per
 *   mount (not on every effect re-run).
 *
 * Manual override (any env): appending `?tour=1` to the URL forces the
 * tour to open once per mount regardless of gates. Useful for QA and
 * for producing screenshots without wiping localStorage.
 */

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAppShell } from '@/components/app/app-shell-provider';
import { useTour } from './tour-provider';
import { hasCompletedTour } from '@/lib/onboarding/tour-storage';

// v0.5.20 — pulled forward to 120ms. The welcome step doesn't anchor
// on any DOM element (it's a centered card), so it doesn't need to
// wait for the predict shell to fully paint. Just enough delay for
// the wallet-adapter modal's fade-out to start so the tour doesn't
// visually collide with it.
const START_DELAY_MS = 120;
// v0.5.23 — bare `/app` renders `<PredictShell />` too (same content
// as `/app/predict`), so the tour anchors exist on that path as well.
// Skip the route-hop when the user is already on either path.
const PREDICT_RE = /^\/(?:[a-z]{2}\/)?app(?:\/predict(?:\/|$)|\/?$)/;
const IS_DEV = process.env.NODE_ENV !== 'production';

function hasTourOverride(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).has('tour');
  } catch {
    return false;
  }
}

export function TourAutoStarter() {
  const { session } = useAppShell();
  const { open, isOpen } = useTour();
  const router = useRouter();
  const pathname = usePathname();

  const wasSignedOutRef = useRef<boolean>(false);
  const firedRef = useRef<boolean>(false);

  useEffect(() => {
    const signedIn = session?.signedIn === true;

    // Once we've seen a `signedIn === false` frame in this mount, we
    // know a subsequent `true` is a real transition (not a stale
    // page-load state). Users who arrive already-signed-in flip
    // straight to true without going through false — in prod that
    // means we skip them; in dev + override we don't care.
    if (!signedIn) {
      wasSignedOutRef.current = true;
      return;
    }
    if (firedRef.current) return;
    if (isOpen) return;

    const override = hasTourOverride();
    if (!override && !IS_DEV) {
      // Prod path: real first-time-login enforcement.
      if (!wasSignedOutRef.current) return;
      if (hasCompletedTour()) return;
    }
    // Dev / override: skip both gates. The `firedRef` guard below
    // still prevents the tour from re-opening on every effect run.

    firedRef.current = true;
    const timerId = window.setTimeout(() => {
      if (!PREDICT_RE.test(pathname)) {
        // Route to /app/predict first, then open the tour on the
        // next tick. Welcome is a centered card with no anchor
        // requirement, so we don't need to wait for the shell's
        // data-tour-id nodes to mount — the composer/topics/etc.
        // steps that DO need those anchors come after Next, giving
        // the shell plenty of time to hydrate before then.
        router.push('/app/predict' as never);
        window.setTimeout(() => open(), 60);
      } else {
        open();
      }
    }, START_DELAY_MS);
    return () => window.clearTimeout(timerId);
  }, [session?.signedIn, isOpen, open, pathname, router]);

  return null;
}
