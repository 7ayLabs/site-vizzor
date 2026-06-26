'use client';

/**
 * useOnboarding — controls the first-run /app/* onboarding stepper.
 *
 * Same pattern as `usePromoModalTrigger` (single localStorage flag, no
 * server state), but:
 *   - Dismissal is permanent by default (no 30-day window). Onboarding
 *     re-opens are explicit (Cmd+K → "Show onboarding") rather than
 *     time-based.
 *   - Auto-open is gated on `signedIn === false` — once the user is
 *     signed in, they've completed the load-bearing onboarding step and
 *     the modal is suppressed even on first visit.
 *
 * Exposes a state machine: `closed | connect | siws | trial-intro | done`.
 * Transitions are driven by both user clicks (advance, skip) and the
 * external auth state (when SIWS verify completes, the modal jumps to
 * trial-intro without further clicks).
 */

import { useCallback, useEffect, useState } from 'react';

export type OnboardingPhase = 'closed' | 'connect' | 'siws' | 'trial-intro' | 'done';

const STORAGE_KEY = 'vizzor.onboarding.dismissed_at';
const AUTO_OPEN_DELAY_MS = 800;

export interface OnboardingState {
  phase: OnboardingPhase;
  /** True while we're between mount and the auto-open decision. */
  isHydrating: boolean;
  open: () => void;
  dismiss: () => void;
  advance: () => void;
  setPhase: (next: OnboardingPhase) => void;
}

function readDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw !== null && raw.length > 0;
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    // best-effort
  }
}

const PHASE_ORDER: OnboardingPhase[] = [
  'connect',
  'siws',
  'trial-intro',
  'done',
];

export function nextPhase(phase: OnboardingPhase): OnboardingPhase {
  const idx = PHASE_ORDER.indexOf(phase);
  if (idx < 0 || idx === PHASE_ORDER.length - 1) return 'closed';
  return PHASE_ORDER[idx + 1] ?? 'closed';
}

interface UseOnboardingArgs {
  /** External signal: is the wallet currently SIWS-signed-in? When this
   *  flips true and the modal is on `connect` or `siws`, we jump to
   *  `trial-intro` so the user sees the welcome step without a fresh
   *  click. */
  signedIn: boolean;
  /** Skip the auto-open path entirely (used in tests). */
  disableAutoOpen?: boolean;
}

export function useOnboarding({
  signedIn,
  disableAutoOpen = false,
}: UseOnboardingArgs): OnboardingState {
  const [phase, setPhase] = useState<OnboardingPhase>('closed');
  const [isHydrating, setIsHydrating] = useState(!disableAutoOpen);

  // Auto-open on first paint when (1) we haven't been dismissed and
  // (2) the user isn't already signed in. Delay matches the promo
  // modal so the two never race for first-paint attention if the same
  // user lands on /pricing then bounces to /app.
  useEffect(() => {
    if (disableAutoOpen) {
      setIsHydrating(false);
      return;
    }
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      if (cancelled) return;
      setIsHydrating(false);
      if (signedIn) return;
      if (readDismissed()) return;
      setPhase('connect');
    }, AUTO_OPEN_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
    // Mount-only — re-evaluating on signedIn flips would re-open the
    // modal after the user signed in and dismissed it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When sign-in completes (SIWS verify), advance past the auth steps
  // automatically — the user already did the load-bearing action.
  useEffect(() => {
    if (!signedIn) return;
    if (phase === 'connect' || phase === 'siws') {
      setPhase('trial-intro');
    }
  }, [signedIn, phase]);

  const open = useCallback(() => setPhase('connect'), []);
  const dismiss = useCallback(() => {
    writeDismissed();
    setPhase('closed');
  }, []);
  const advance = useCallback(() => {
    setPhase((p) => nextPhase(p));
  }, []);

  return { phase, isHydrating, open, dismiss, advance, setPhase };
}
