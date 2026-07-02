'use client';

/**
 * TourAutoStarter — fires the guided tour on the wallet's first
 * successful SIWS handshake per browser.
 *
 * Trigger rule (matches the plan's "Trigger contract" section):
 *   1. `signedIn` transitions false → true (in-session, not a page-
 *      load where the user was already signed in).
 *   2. `hasCompletedTour()` returns false (no persistent flag).
 *   3. Wait `START_DELAY_MS` so the OnboardingStepper's `trial-intro`
 *      step has a chance to land + auto-dismiss without racing.
 *   4. If we're not on `/app/predict`, route there first — the tour
 *      steps spotlight elements that only exist on the predict shell.
 *   5. Call `useTour().open()`.
 *
 * The transition is tracked with a ref so a full page load with
 * `signedIn === true` from the start does NOT fire the tour (that
 * user has been through auth before; the flag not being set means
 * they're on a fresh browser and would have seen `OnboardingStepper`
 * finish up first). The transition only "counts" when we observed
 * `signedIn === false` at least once in this mount.
 */

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAppShell } from '@/components/app/app-shell-provider';
import { useTour } from './tour-provider';
import { hasCompletedTour } from '@/lib/onboarding/tour-storage';

const START_DELAY_MS = 1200;
const PREDICT_RE = /^\/(?:[a-z]{2}\/)?app\/predict(?:\/|$)/;

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
    // straight to true without going through false and are ignored.
    if (!signedIn) {
      wasSignedOutRef.current = true;
      return;
    }
    if (!wasSignedOutRef.current) return;
    if (firedRef.current) return;
    if (isOpen) return;
    if (hasCompletedTour()) return;

    firedRef.current = true;
    const timerId = window.setTimeout(() => {
      if (!PREDICT_RE.test(pathname)) {
        // Route to /app/predict first, then open the tour after the
        // navigation resolves. Casting through never bypasses
        // typedRoutes; the target is well-formed.
        router.push('/app/predict' as never);
        // Open on the next tick so the predict shell has a chance
        // to mount its data-tour-id anchors.
        window.setTimeout(() => open(), 250);
      } else {
        open();
      }
    }, START_DELAY_MS);
    return () => window.clearTimeout(timerId);
  }, [session?.signedIn, isOpen, open, pathname, router]);

  return null;
}
