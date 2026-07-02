/**
 * TOUR_STEPS — declarative catalogue of first-time-login tour stops.
 *
 * Each step points at a stable `data-tour-id` attribute (added to
 * the target components in this same PR). Steps without a
 * `targetSelector` render as centered cards (welcome + done).
 *
 * `placement` is a hint for the callout position relative to the
 * spotlight; the SpotlightTour picks the actual side based on
 * available viewport space and falls back gracefully at small
 * widths. Steps that only make sense at `lg+` viewports (sidebar
 * entries) get `mobileFallback: 'centered'` so the mobile flow
 * still narrates them without pointing at an element that isn't
 * on screen.
 */

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'centered';

export interface TourStep {
  id: string;
  /** CSS selector for the target element. Omit for centered cards. */
  targetSelector?: string;
  /** Preferred callout position; SpotlightTour re-picks at render if
   *  space is tight. Ignored for centered cards. */
  placement?: TourPlacement;
  /** When the target only exists on desktop breakpoints, render
   *  centered on mobile instead of missing the element. */
  mobileFallback?: 'centered' | 'skip';
  /** i18n key under `predict.tour.steps.<id>`. Both `.title` and
   *  `.body` are required at that key. */
  i18nKey: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    i18nKey: 'welcome',
  },
  {
    id: 'composer',
    targetSelector: '[data-tour-id="composer-input"]',
    placement: 'top',
    i18nKey: 'composer',
  },
  {
    id: 'topics',
    targetSelector: '[data-tour-id="composer-topics"]',
    placement: 'top',
    mobileFallback: 'centered',
    i18nKey: 'topics',
  },
  {
    id: 'tray',
    /**
     * CapabilityTray only mounts when the wallet has an active ticker
     * (a first-time user won't). SpotlightTour treats a missing
     * target as an implicit centered fallback, so the tour narrates
     * the tray without needing the element on screen — same posture
     * as `mobileFallback: 'centered'`.
     */
    targetSelector: '[data-tour-id="capability-tray"]',
    placement: 'top',
    mobileFallback: 'centered',
    i18nKey: 'tray',
  },
  {
    id: 'nav-alerts',
    targetSelector: '[data-tour-id="nav-alerts"]',
    placement: 'right',
    mobileFallback: 'centered',
    i18nKey: 'navAlerts',
  },
  {
    id: 'nav-transactions',
    targetSelector: '[data-tour-id="nav-transactions"]',
    placement: 'right',
    mobileFallback: 'centered',
    i18nKey: 'navTransactions',
  },
  {
    id: 'identity',
    targetSelector: '[data-tour-id="identity-row"]',
    placement: 'right',
    mobileFallback: 'centered',
    i18nKey: 'identity',
  },
  {
    id: 'done',
    i18nKey: 'done',
  },
];

export function stepAt(index: number): TourStep | null {
  if (index < 0 || index >= TOUR_STEPS.length) return null;
  return TOUR_STEPS[index] ?? null;
}

export function totalSteps(): number {
  return TOUR_STEPS.length;
}
