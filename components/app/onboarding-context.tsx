'use client';

/**
 * OnboardingContext — exposes the onboarding stepper's open() handler
 * to anything that wants to re-trigger it (e.g. Cmd+K command palette
 * "Show onboarding" action).
 *
 * The actual phase machine lives in `useOnboarding()`; this context is
 * a thin pointer to that hook's `open()` callback, populated by the
 * OnboardingStepper when it mounts. Callers outside the stepper only
 * ever need to nudge it open — they don't manage state.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

export interface OnboardingControls {
  /** Re-trigger the onboarding stepper from anywhere in /app/*.
   *  No-op until the stepper has mounted and registered itself. */
  open: () => void;
}

interface OnboardingContextValue extends OnboardingControls {
  registerOpener: (fn: () => void) => void;
}

const Ctx = createContext<OnboardingContextValue | null>(null);

export function OnboardingControlsProvider({ children }: { children: ReactNode }) {
  // Ref-based opener — registration is a plain mutation, NOT a setState
  // call, so callers can register from inside render without triggering
  // a cross-component state update (React 19 flags that as a hard
  // error). The provider itself never re-renders when the stepper
  // (re)mounts; consumers always read the latest opener via the ref
  // trampoline below.
  const openerRef = useRef<() => void>(() => {});
  const value = useMemo<OnboardingContextValue>(
    () => ({
      open: () => openerRef.current(),
      registerOpener: (fn) => {
        openerRef.current = fn;
      },
    }),
    [],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOnboardingControls(): OnboardingControls {
  const ctx = useContext(Ctx);
  // Returning a no-op pair when out-of-tree keeps the catalog command
  // testable without forcing every consumer to wrap in the provider.
  if (!ctx) return { open: () => {} };
  return { open: ctx.open };
}

export function useRegisterOnboardingOpener(open: () => void) {
  const ctx = useContext(Ctx);
  // Stash the latest callback in a ref so the trampoline registered
  // below stays stable across re-renders of the caller. Without this,
  // every parent render would re-register and the effect deps would
  // churn.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!ctx) return;
    ctx.registerOpener(() => openRef.current());
  }, [ctx]);
}
