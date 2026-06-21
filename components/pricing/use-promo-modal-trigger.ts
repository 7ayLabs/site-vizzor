'use client';

/**
 * usePromoModalTrigger — opens the /pricing lifetime promo modal once
 * per visitor and remembers the dismissal in localStorage for 30 days.
 *
 * On /pricing mount, waits ~600ms after first paint, then opens the
 * modal IF the dismissal flag is absent or older than the 30-day
 * window. On dismiss, writes Date.now() to localStorage so the modal
 * doesn't re-open on subsequent visits inside the window.
 *
 * The hook returns a tuple { open, openManually, dismiss } so a
 * floating re-trigger pill at the bottom of /pricing can call
 * openManually() without resetting the dismissal flag — that's the
 * "I dismissed but want to see it again" path.
 */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'vizzor.promo.lifetime.dismissed_at';
const SUPPRESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const AUTO_OPEN_DELAY_MS = 600;

export interface PromoModalTrigger {
  open: boolean;
  openManually: () => void;
  dismiss: () => void;
}

export function usePromoModalTrigger(): PromoModalTrigger {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      if (cancelled) return;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const dismissedAt = Number.parseInt(raw, 10);
          if (
            Number.isFinite(dismissedAt) &&
            Date.now() - dismissedAt < SUPPRESS_WINDOW_MS
          ) {
            return;
          }
        }
      } catch {
        // localStorage may be unavailable (private mode, quota). In
        // that case treat as "no prior dismissal" and open the modal;
        // failure to suppress is the right default for promotional UX.
      }
      setOpen(true);
    }, AUTO_OPEN_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, []);

  const openManually = useCallback(() => {
    setOpen(true);
  }, []);

  const dismiss = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // silent — the modal still closes for this session, just won't
      // remember the dismissal across reloads.
    }
  }, []);

  return { open, openManually, dismiss };
}
