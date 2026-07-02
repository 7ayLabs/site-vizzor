'use client';

/**
 * TourProvider — first-time-login guided tour state + controls.
 *
 * Uses a ref-based opener the SpotlightTour registers on mount,
 * exposed to any consumer that needs to trigger the tour (Cmd+K
 * palette, the auto-starter, a future "restart tutorial" button in
 * settings).
 *
 * Keeping the state machine here — rather than inside SpotlightTour
 * — means the auto-starter can drive the tour without waiting for
 * the overlay to hydrate first. The overlay reads `stepIndex`
 * reactively; the auto-starter calls `open()` and forgets.
 *
 * Deliberately NOT persisted across mounts: closing + reopening
 * always starts at step 0. That matches the intent — the tour is a
 * one-shot pedagogical moment, not a resumable process. Persistence
 * across browser sessions is handled by `lib/onboarding/tour-storage`
 * via a completed-or-skipped flag; this provider only cares about
 * the current mount.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface TourControls {
  /** Open the tour at step 0. Idempotent — a second `open()` while
   *  already open resets the index. */
  open: () => void;
  /** Close the tour without advancing further. Does NOT write the
   *  completed flag; the caller decides whether this was a skip or
   *  a normal finish. */
  close: () => void;
  /** Advance one step. Callers should use this over the raw setter
   *  so a future analytics hook can piggy-back on the transition. */
  next: () => void;
  /** Rewind one step. Clamped at 0. */
  prev: () => void;
  /** Reset back to step 0 without closing. Used when the auto-starter
   *  re-fires (e.g. same browser, second wallet). */
  reset: () => void;
}

interface TourState extends TourControls {
  /** True while the overlay is visible. */
  isOpen: boolean;
  /** Which step (index into TOUR_STEPS) is currently spotlighted. */
  stepIndex: number;
}

const Ctx = createContext<TourState | null>(null);

export function TourProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const open = useCallback(() => {
    setStepIndex(0);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);
  const reset = useCallback(() => setStepIndex(0), []);
  const next = useCallback(() => setStepIndex((i) => i + 1), []);
  const prev = useCallback(() => setStepIndex((i) => Math.max(0, i - 1)), []);

  const value = useMemo<TourState>(
    () => ({ isOpen, stepIndex, open, close, next, prev, reset }),
    [isOpen, stepIndex, open, close, next, prev, reset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Consumer hook. Returns a safe no-op shape if called outside the
 * provider so ad-hoc callers (tests, isolated stories) don't crash.
 */
export function useTour(): TourState {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return {
      isOpen: false,
      stepIndex: 0,
      open: () => {},
      close: () => {},
      next: () => {},
      prev: () => {},
      reset: () => {},
    };
  }
  return ctx;
}
