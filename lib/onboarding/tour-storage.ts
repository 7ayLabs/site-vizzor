/**
 * Storage for the first-time-login guided tour flag.
 *
 * v0.5.4 — the tour fires exactly once per browser per wallet-that-
 * signs-in. localStorage is enough: worst case a user who clears
 * storage sees a friendly refresher on next login. Server-side
 * first-login tracking (add `first_siws_login_at` on `auth_sessions`)
 * is a follow-up if user testing shows clear-browser cases matter.
 *
 * Key format: `vizzor.tour.completed_at` — the timestamp of the
 * completed-or-skipped moment. Presence (non-null string) is the
 * gate; the numeric value is diagnostic only.
 *
 * Every read/write is defensively wrapped: localStorage can throw
 * in Safari private-mode + third-party-cookie-blocking scenarios,
 * and a UX polish path must never take down the app.
 */

const STORAGE_KEY = 'vizzor.tour.completed_at';

export function hasCompletedTour(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw !== null && raw.length > 0;
  } catch {
    // localStorage blocked — treat as "not completed" so the tour
    // has a chance to run. If storage stays blocked the flag never
    // persists and the tour re-fires per SIWS sign-in, which is
    // annoying but not broken.
    return false;
  }
}

export function markTourCompleted(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    /* silent — best-effort */
  }
}

/**
 * Wipe the flag. Not exposed to the UI (there's no "reset tour"
 * button) but useful for tests and for Cmd+K debugging in dev.
 */
export function clearTourFlag(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* silent */
  }
}

export const TOUR_STORAGE_KEY = STORAGE_KEY;
