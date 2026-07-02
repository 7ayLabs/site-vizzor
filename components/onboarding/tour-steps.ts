/**
 * TOUR_STEPS — declarative catalogue of first-time-login tour stops.
 *
 * Each step points at a stable `data-tour-id` attribute (added to
 * the target components in the same PR that introduced this
 * catalogue). Steps without a `targetSelector` render as centered
 * cards (welcome + done).
 *
 * v0.5.5 — platform-aware:
 *   - Desktop rail entries (nav-alerts, nav-transactions, identity)
 *     only exist on `lg+`. On mobile those same actions live inside
 *     the hamburger drawer, so we replace them with a single
 *     mobile-menu step that spotlights the hamburger trigger.
 *   - `desktopOnly` / `mobileOnly` flags are read at render time by
 *     SpotlightTour to filter the visible step list. `stepsFor()`
 *     returns the filtered list for a given platform.
 *
 * `placement` is a hint for the callout position relative to the
 * spotlight; the SpotlightTour picks the actual side based on
 * available viewport space and falls back gracefully at small
 * widths.
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
  /** Only surface this step on `lg+` viewports. Used for sidebar
   *  entries that are hidden behind the drawer on mobile. */
  desktopOnly?: boolean;
  /** Only surface this step on `< lg` viewports. Used for the
   *  hamburger trigger which is hidden on desktop. */
  mobileOnly?: boolean;
  /** v0.5.8 — when true, the "Next" button is hidden and the tour
   *  ONLY advances when the user actually clicks the target
   *  element. Used for the mobile-menu step so the user has to
   *  tap the hamburger to open the drawer before the tour
   *  continues (otherwise the sidebar-nav steps that follow have
   *  nothing to spotlight). */
  requiresClick?: boolean;
  /** v0.5.8 — when true, an animated pointer slides horizontally
   *  across the spotlight so the user knows the target is a
   *  scrollable strip. Set on the `carousel` step. */
  showSwipeHint?: boolean;
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
    id: 'carousel',
    /**
     * Ticker + sector chip row above the composer. Tapping a chip
     * activates a token; the carousel body copy already narrates
     * "that's what unlocks the send/pay icons", so we no longer
     * need a follow-up `tray` step (deleted v0.5.7 — the tray was
     * always centered/absent for a first-time user without an
     * armed ticker, and the copy was redundant with this step's).
     */
    targetSelector: '[data-tour-id="topic-carousel"]',
    placement: 'top',
    showSwipeHint: true,
    i18nKey: 'carousel',
  },
  /**
   * v0.5.8 — the `mobile-menu` step sits BEFORE the sidebar steps
   * on mobile. It's an explicit instruction to open the drawer;
   * once the user taps ☰, the same `data-tour-id` anchors that
   * live on the desktop LeftRail are exposed INSIDE the drawer
   * (predict-shell mounts LeftRail as the drawer body), so the
   * subsequent nav-alerts / nav-transactions / identity steps
   * point at the same elements with the same text as desktop.
   * That's the "iOS oriented, same text" ask from user testing.
   */
  {
    id: 'mobile-menu',
    targetSelector: '[data-tour-id="mobile-menu-trigger"]',
    placement: 'bottom',
    mobileOnly: true,
    /**
     * User has to actually tap the hamburger to advance — otherwise
     * the sidebar steps that follow have no anchor to spotlight
     * (LeftRail is only mounted inside the drawer once it's open).
     */
    requiresClick: true,
    i18nKey: 'mobileMenu',
  },
  {
    id: 'nav-alerts',
    targetSelector: '[data-tour-id="nav-alerts"]',
    placement: 'right',
    /**
     * mobileFallback: the anchor lives inside the mobile drawer
     * (LeftRail is remounted there on /app/predict). If the user
     * hasn't opened the drawer yet when they hit Next, we render
     * a centered callout so the tour keeps moving instead of
     * stalling on a missing target.
     */
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

/** Return the ordered step list for a given viewport. */
export function stepsFor(isMobile: boolean): readonly TourStep[] {
  return TOUR_STEPS.filter((s) => {
    if (isMobile && s.desktopOnly) return false;
    if (!isMobile && s.mobileOnly) return false;
    return true;
  });
}
