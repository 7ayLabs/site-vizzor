'use client';

/**
 * SpotlightTour — full-viewport overlay + animated spotlight + callout
 * card for the first-time-login guided tour.
 *
 * v0.5.5 polish (design review):
 *   - Callout chrome now matches the IntentChatCard vocabulary: soft
 *     depth ring, thin top accent bar, mono/tabular typography,
 *     tighter progress bar under the step dots. No more "vibecoded"
 *     look; the surface reads as a system dialog, not a plugin.
 *   - Icon-based skip (X in top-right) replaces the SALTAR text link.
 *   - The SVG spotlight rect transitions its x/y/width/height on
 *     step change, so the aperture morphs to the next target
 *     instead of blinking. The callout position transitions the
 *     same way. Content cross-fades between steps.
 *   - Platform-aware: reads `stepsFor(isMobile)` so the list itself
 *     changes based on the viewport (mobile gets the hamburger
 *     step; desktop gets sidebar entries).
 *
 * Rendering architecture:
 *   - SVG covering the viewport with an alpha-black rect + a single
 *     transparent rect cutout that moves between targets. Doing the
 *     cutout as an SVG mask (rather than a CSS box-shadow trick)
 *     gives sub-pixel-clean edges on high-DPR displays and lets us
 *     animate x/y/width/height with plain CSS transitions.
 *   - Callout is `position: fixed`. Its top/left transition with the
 *     same 320ms curve as the spotlight so the pair moves as a unit.
 *
 * Keyboard model:
 *   Escape → skip (writes flag, closes)
 *   →      → next step (or finish on the last one)
 *   ←      → previous step (clamped at 0)
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CoinIcon } from '@/components/ui/coin-icon';
import { useTour } from './tour-provider';
import { stepsFor, type TourStep } from './tour-steps';
import { markTourCompleted } from '@/lib/onboarding/tour-storage';

const CALLOUT_WIDTH = 340;
const CALLOUT_HEIGHT_ESTIMATE = 210;
const CALLOUT_MARGIN = 16;
/**
 * How far the callout stays away from the target rect. Includes
 * SPOTLIGHT_PADDING (the halo we already draw around the target) plus
 * a visual gap so the callout never appears to touch the target.
 */
const CALLOUT_TARGET_GAP = 20;
const SPOTLIGHT_PADDING = 6;
const MOBILE_BREAKPOINT = 1024; // Match Tailwind's `lg` — sidebar
// entries only exist above this width in every /app/* surface.

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function SpotlightTour() {
  const { isOpen, stepIndex, next, prev, close } = useTour();
  const t = useTranslations('predict.tour');
  const [mounted, setMounted] = useState(false);
  const [viewport, setViewport] = useState<{ w: number; h: number }>(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1024,
    h: typeof window !== 'undefined' ? window.innerHeight : 768,
  }));
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const calloutRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const lastStepIdxRef = useRef<number>(0);
  /**
   * Real callout dimensions after render. We start with the estimate
   * so the first paint has a valid position, then swap to measured
   * values on the next frame via ResizeObserver. This is the fix for
   * long-copy steps (Skills/connectors, mobile-actions) where the
   * actual height was 2-3x the 176px estimate and the callout ended
   * up overlapping its target.
   */
  const [calloutSize, setCalloutSize] = useState<{ w: number; h: number }>({
    w: CALLOUT_WIDTH,
    h: CALLOUT_HEIGHT_ESTIMATE,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const isMobile = viewport.w < MOBILE_BREAKPOINT;
  const steps = useMemo(() => stepsFor(isMobile), [isMobile]);
  const total = steps.length;
  const clampedIndex = Math.min(Math.max(0, stepIndex), Math.max(0, total - 1));
  const step: TourStep | null = steps[clampedIndex] ?? null;

  const isCentered = useMemo<boolean>(() => {
    if (!step) return true;
    if (!step.targetSelector) return true;
    if (isMobile && step.mobileFallback === 'centered') return true;
    return targetRect === null;
  }, [step, isMobile, targetRect]);

  // Viewport tracker — re-render on resize.
  useEffect(() => {
    if (!isOpen) return;
    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isOpen]);

  // Real callout size tracker. Observes the callout element and
  // pushes measured w/h into state so the position math uses
  // reality, not an estimate. Re-observes on step change since a
  // new step may have shorter/longer copy.
  useEffect(() => {
    if (!isOpen) return;
    const el = calloutRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      setCalloutSize((prev) =>
        prev.w === w && prev.h === h ? prev : { w, h },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOpen, clampedIndex]);

  // Target rect tracker. Re-selects the target on step change +
  // recomputes on scroll / resize / mutation of a stale target.
  useEffect(() => {
    if (!isOpen || !step?.targetSelector) {
      setTargetRect(null);
      return;
    }
    if (isMobile && step.mobileFallback === 'centered') {
      setTargetRect(null);
      return;
    }
    /**
     * v0.5.14 — rAF-based tracker so the spotlight follows the target
     * through any layout change (drawer slide-in, orientation change,
     * lazy-mounted rails, virtualized list scroll). Previous
     * one-shot compute() missed the mobile-drawer opening because
     * the drawer's 200ms slide-in wasn't finished when we measured,
     * and no scroll/resize event fired to trigger a recompute — so
     * the cutout got stuck at the pre-animation coords and never
     * appeared around "Alertas".
     *
     * The rAF loop rechecks up to 60fps for the first 3 seconds
     * after step change, then throttles to every 250ms so the spot
     * still tracks slow layout shifts (SWR-driven remounts, badge
     * counter growth) without burning CPU forever.
     */
    let rafId = 0;
    let cancelled = false;
    const startMs = performance.now();
    const lastRectRef: { r: DOMRect | null } = { r: null };
    const compute = (now: number) => {
      if (cancelled) return;
      const el = findVisibleTarget(step.targetSelector!);
      if (!el) {
        if (lastRectRef.r !== null) {
          lastRectRef.r = null;
          setTargetRect(null);
        }
      } else {
        const r = el.getBoundingClientRect();
        const prev = lastRectRef.r;
        if (
          !prev ||
          prev.top !== r.top ||
          prev.left !== r.left ||
          prev.width !== r.width ||
          prev.height !== r.height
        ) {
          lastRectRef.r = r;
          setTargetRect({
            top: r.top,
            left: r.left,
            width: r.width,
            height: r.height,
          });
        }
      }
      const elapsed = now - startMs;
      if (elapsed < 3000) {
        rafId = window.requestAnimationFrame(compute);
      } else {
        rafId = window.setTimeout(
          () => compute(performance.now()),
          250,
        ) as unknown as number;
      }
    };
    rafId = window.requestAnimationFrame(compute);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(rafId);
    };
  }, [isOpen, step, isMobile]);

  // Content cross-fade — reapply the `.vz-tour-content-in` class on
  // every step change so the title/body fade fresh.
  useEffect(() => {
    if (!isOpen) return;
    if (lastStepIdxRef.current === clampedIndex) return;
    lastStepIdxRef.current = clampedIndex;
    const el = contentRef.current;
    if (!el) return;
    el.classList.remove('vz-tour-content-in');
    // Force reflow so the animation restarts on the next frame.
    void el.offsetWidth;
    el.classList.add('vz-tour-content-in');
  }, [isOpen, clampedIndex]);

  const onFinish = useCallback(() => {
    markTourCompleted();
    close();
  }, [close]);

  const onNextClick = useCallback(() => {
    if (clampedIndex >= total - 1) {
      onFinish();
    } else {
      next();
    }
  }, [clampedIndex, total, next, onFinish]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onFinish();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onNextClick();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onFinish, onNextClick, prev]);

  // Focus the callout when it opens or when the step changes.
  useEffect(() => {
    if (!isOpen) return;
    const raf = requestAnimationFrame(() => {
      calloutRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [isOpen, clampedIndex]);

  // v0.5.10 — `showSwipeHint` steps: animate a horizontal scroll on
  // the target's scrollable child so the user notices the target is
  // a scrollable strip (the topic carousel). Way more explicit than
  // an abstract pointer sliding across the spotlight — the user sees
  // the ETH / GRAM / SOL chips actually move in the strip.
  useEffect(() => {
    if (!isOpen || !step?.showSwipeHint || !step.targetSelector) return;
    const el = findVisibleTarget(step.targetSelector);
    if (!el) return;
    // The scrollable child. Falls back to the target itself when the
    // target IS the scroll container.
    const scroller =
      el.querySelector<HTMLElement>('[data-tour-scroll], ul, .overflow-x-auto') ??
      el;
    if (
      !scroller ||
      scroller.scrollWidth <= scroller.clientWidth + 4
    ) {
      return;
    }
    const savedScroll = scroller.scrollLeft;
    const targetScroll = Math.min(
      scroller.scrollWidth - scroller.clientWidth,
      savedScroll + Math.max(120, scroller.clientWidth * 0.4),
    );
    let cancelled = false;
    const runOnce = () => {
      if (cancelled) return;
      scroller.scrollTo({ left: targetScroll, behavior: 'smooth' });
      window.setTimeout(() => {
        if (cancelled) return;
        scroller.scrollTo({ left: savedScroll, behavior: 'smooth' });
      }, 1400);
    };
    const first = window.setTimeout(runOnce, 400);
    const loop = window.setInterval(runOnce, 3600);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(loop);
      scroller.scrollTo({ left: savedScroll, behavior: 'auto' });
    };
  }, [isOpen, step]);

  // v0.5.8 — `requiresClick` steps: advance the tour only when the
  // user actually clicks the target element. This is the gate for
  // the mobile-menu step so we can't skip past a closed drawer.
  // The SVG backdrop is pointer-events: none, so clicks reach the
  // target normally + fire its own onClick handler (which opens
  // the drawer) alongside our listener (which advances the tour).
  useEffect(() => {
    if (!isOpen || !step?.requiresClick || !step.targetSelector) return;
    const el = findVisibleTarget(step.targetSelector);
    if (!el) return;
    // A tick to make sure a synthetic click that fired to open the
    // tour doesn't accidentally auto-advance the requires-click step.
    let armed = false;
    const armId = window.setTimeout(() => {
      armed = true;
    }, 100);
    const onClick = () => {
      if (!armed) return;
      // Small delay so the drawer has time to expand before we
      // advance and try to spotlight the next target (which lives
      // inside the drawer).
      window.setTimeout(() => next(), 300);
    };
    el.addEventListener('click', onClick);
    return () => {
      window.clearTimeout(armId);
      el.removeEventListener('click', onClick);
    };
  }, [isOpen, step, next]);

  if (!isOpen || !mounted || !step) return null;

  const isFirst = clampedIndex === 0;
  const isLast = clampedIndex === total - 1;
  const stepTitle = t(`steps.${step.i18nKey}.title` as never);
  const stepBody = t(`steps.${step.i18nKey}.body` as never);

  const calloutPos = computeCalloutPos({
    isCentered,
    targetRect,
    viewport,
    preferred: step.placement,
    calloutSize,
  });
  const actualCalloutWidth = Math.min(
    CALLOUT_WIDTH,
    Math.max(260, viewport.w - CALLOUT_MARGIN * 2),
  );

  // When centered (welcome / done / mobile fallbacks), collapse the
  // cutout to a zero-sized rect off-screen so the transition still
  // has valid values to interpolate but the backdrop is fully dim.
  const spotlight = targetRect && !isCentered
    ? {
        x: Math.round(targetRect.left - SPOTLIGHT_PADDING),
        y: Math.round(targetRect.top - SPOTLIGHT_PADDING),
        width: Math.round(targetRect.width + SPOTLIGHT_PADDING * 2),
        height: Math.round(targetRect.height + SPOTLIGHT_PADDING * 2),
      }
    : {
        // Off-viewport placeholder so the rect transition still has
        // finite values to animate. Zero width/height is fine as the
        // rect stays hidden by SVG semantics.
        x: viewport.w / 2,
        y: viewport.h / 2,
        width: 0,
        height: 0,
      };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vz-tour-title"
      className="fixed inset-0 z-[90] motion-safe:vz-spotlight-mask-in"
      /**
       * v0.5.10 — pointer-events: none on the wrapper so clicks land
       * on the element beneath (the hamburger for the mobile-menu
       * step, etc.). The callout below sets pointer-events: auto so
       * Skip / Back / Next / Escape stay interactive.
       */
      style={{ pointerEvents: 'none' }}
    >
      {/* SVG spotlight backdrop.
          v0.5.8 pointer-events: none — clicks pass THROUGH the
          backdrop to whatever's underneath (the target element).
          That's the enabler for requiresClick steps: the user can
          actually tap the hamburger to advance the tour. Skip /
          next / prev clicks land on the callout which sits in a
          separate stacking context with its own pointer events.
          The mask cuts a transparent hole around the target so the
          user sees what to click; the extra ring rect below adds
          a visible pulsing border so the target reads as "focused"
          rather than dim (user feedback on the Skills step). */}
      {/* v0.5.17 — full-screen dim + viewport-wide box-shadow both
          retired. The tour now leaves the page fully visible and
          fully interactive: users can browse, click, and read the
          rest of the app while the callout is on-screen. Only the
          target gets a highlight ring so the eye still tracks the
          step, and centered steps (welcome / done) just float the
          callout with no backdrop at all. */}
      {targetRect && !isCentered && (
        <div
          aria-hidden
          className="vz-tour-spotlight vz-tour-spotlight-rect"
          style={{
            position: 'fixed',
            top: spotlight.y,
            left: spotlight.x,
            width: spotlight.width,
            height: spotlight.height,
            /**
             * Highlight ring — no viewport dim. Uses --accent so the
             * target stands out against both light and dark themes,
             * with a soft outer glow so the ring reads as focused
             * attention rather than a hard border. The transition
             * on the rect's top/left/width/height (globals.css)
             * still animates between steps.
             */
            borderRadius: 8,
            boxShadow:
              '0 0 0 2px color-mix(in oklab, var(--accent) 85%, transparent), 0 0 0 6px color-mix(in oklab, var(--accent) 22%, transparent), 0 10px 32px -8px color-mix(in oklab, var(--accent) 45%, transparent)',
            outline: 'none',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Callout card — flat, no glow, no accent stripe. Restraint
          matches the IntentChatCard vocabulary already in the app. */}
      <div
        ref={calloutRef}
        tabIndex={-1}
        style={{
          position: 'fixed',
          top: calloutPos.top,
          left: calloutPos.left,
          width: actualCalloutWidth,
          maxWidth: viewport.w - CALLOUT_MARGIN * 2,
          maxHeight: viewport.h - CALLOUT_MARGIN * 2,
          overflowY: 'auto',
          // v0.5.10 — buttons + text inside the callout stay clickable
          // even though the wrapper is pointer-events: none.
          pointerEvents: 'auto',
        }}
        className={cn(
          'vz-tour-callout',
          'rounded-xl',
          'bg-[var(--surface)]',
          'border border-[var(--border)]',
          // v0.5.17 — depth shadow now that the viewport dim is gone.
          // Without a backdrop, the callout would otherwise blend into
          // whatever content sits behind it. A soft ambient shadow
          // reads as "system dialog floating above the page" without
          // the vibecoded glow feel.
          'shadow-[0_20px_48px_-16px_rgba(0,0,0,0.35),0_2px_8px_-2px_rgba(0,0,0,0.2)]',
          'focus:outline-none',
          'motion-safe:vz-tour-callout-in',
        )}
      >
        <div ref={contentRef} className="vz-tour-content-in p-5">
          {/* X close — top-right, absolute so it stays anchored even
              on the welcome step where the header content is
              centered instead of left-aligned. */}
          <button
            type="button"
            onClick={onFinish}
            aria-label={t('skip')}
            className={cn(
              'absolute top-3 right-3 z-[1]',
              'inline-flex items-center justify-center h-7 w-7 rounded-full',
              'text-[var(--fg-3)] hover:text-[var(--fg)]',
              'hover:bg-[color-mix(in_oklab,var(--fg)_6%,transparent)]',
              'transition-colors',
            )}
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>

          {step.id === 'welcome' ? (
            /* Welcome layout — center-aligned hero with overlapping
               icon row on top, then title + body. Matches the
               reference (image 127): "Welcome to Zipmex!" +
               ETH/BTC/… icons stack. Ours uses Vizzor + the four
               native chain / topic chips (BTC, ETH, SOL, GRAM). */
            <div className="flex flex-col items-center text-center">
              <WelcomeIconRow />
              <h2
                id="vz-tour-title"
                className="mt-4 text-[18px] font-semibold tracking-tight text-[var(--fg)] leading-tight break-words"
              >
                {stepTitle}
              </h2>
              <p className="mt-2 max-w-[42ch] text-[13.5px] leading-relaxed text-[var(--fg-2)] break-words">
                {stepBody}
              </p>
            </div>
          ) : (
            <>
              {/* Header row — title on the left, X sits absolute in
                  the top-right (rendered above). */}
              <div className="flex items-start pr-9">
                <h2
                  id="vz-tour-title"
                  className="text-[16px] font-semibold tracking-tight text-[var(--fg)] leading-tight break-words"
                >
                  {stepTitle}
                </h2>
              </div>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--fg-2)] break-words">
                {stepBody}
              </p>
            </>
          )}

          {/* Footer row — page-indicator dots on the left, primary
              action on the right. Structure mirrors the reference
              designs the user shared: small dots (active = solid,
              rest = faded), one dark-pill CTA on the far right.
              Back is retained as a tiny secondary link on the far
              left of the row (not present in the reference for
              brevity, but users need it to correct a misclick). */}
          <div className="mt-5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {!isFirst && (
                <button
                  type="button"
                  onClick={prev}
                  aria-label={t('previous')}
                  className={cn(
                    'inline-flex items-center justify-center h-6 px-1.5 rounded-md',
                    'text-[11.5px] text-[var(--fg-3)] hover:text-[var(--fg)]',
                    'transition-colors',
                  )}
                >
                  ←
                </button>
              )}
              {/* Page-indicator dots — all the same size to match the
                  reference (image 126). Active dot: solid `--fg`.
                  Inactive dots: faded (`--fg` 18%). No shape change
                  between states, just color. */}
              <div className="flex items-center gap-1.5">
                {Array.from({ length: total }).map((_, i) => (
                  <span
                    key={i}
                    aria-hidden
                    className={cn(
                      'h-1.5 w-1.5 rounded-full transition-colors duration-300',
                      i === clampedIndex
                        ? 'bg-[var(--fg)]'
                        : 'bg-[color-mix(in_oklab,var(--fg)_18%,transparent)]',
                    )}
                  />
                ))}
              </div>
            </div>
            {step.requiresClick ? (
              /* Require-click gate: no Next button, no hint text.
                 The tour advances only when the user clicks the
                 target (see useEffect wiring above). Copy alone
                 carries the instruction — Zipmex-reference style. */
              <span aria-hidden />
            ) : (
              <button
                type="button"
                onClick={onNextClick}
                className={cn(
                  'inline-flex items-center justify-center h-9 px-5 rounded-full',
                  'text-[13px] font-semibold',
                  'bg-[var(--fg)] text-[var(--bg)]',
                  'hover:opacity-90 active:scale-[0.98]',
                  'transition-[opacity,transform] duration-150',
                )}
              >
                {isLast ? t('finish') : t('next')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Pick a callout position that avoids clipping AND never overlaps
 * the target rect.
 *
 * v0.5.7 fixes:
 *   - Uses `calloutSize` (measured after render, not an estimate) so
 *     long-copy steps position themselves correctly. Steps like
 *     "Skills, connectors, integrations" have ~150 chars of body
 *     and render at ~280px tall; the old 176px estimate led to
 *     mis-placement that let the card overlap its target.
 *   - Anchored steps NEVER use `centered` as a fallback anymore.
 *     If every side is tight, we pick the side with the most space
 *     and clamp — so the callout still points at the target instead
 *     of drifting off into the middle of the viewport where the
 *     user has to guess what's being highlighted.
 *   - Every branch clamps both top AND left to the safe range so
 *     the card is guaranteed fully inside the viewport.
 *   - After clamping, we run an overlap check against the target's
 *     bounds; if the two rects intersect, we push the callout to
 *     the free axis. That's the belt-and-braces guarantee against
 *     the "modal blocks the actionable" bug from the screenshots.
 */
function computeCalloutPos({
  isCentered,
  targetRect,
  viewport,
  preferred,
  calloutSize,
}: {
  isCentered: boolean;
  targetRect: Rect | null;
  viewport: { w: number; h: number };
  preferred: TourStep['placement'];
  calloutSize: { w: number; h: number };
}): { top: number; left: number } {
  // Actual dimensions — measured post-render for anchored steps, or
  // the estimate on first paint before the observer fires.
  const cardWidth = Math.min(
    calloutSize.w || CALLOUT_WIDTH,
    Math.max(260, viewport.w - CALLOUT_MARGIN * 2),
  );
  const cardHeight = Math.max(
    120,
    Math.min(
      calloutSize.h || CALLOUT_HEIGHT_ESTIMATE,
      viewport.h - CALLOUT_MARGIN * 2,
    ),
  );

  // Safe range for top/left.
  const maxTop = Math.max(CALLOUT_MARGIN, viewport.h - cardHeight - CALLOUT_MARGIN);
  const maxLeft = Math.max(CALLOUT_MARGIN, viewport.w - cardWidth - CALLOUT_MARGIN);

  const centeredTop = clamp(
    viewport.h / 2 - cardHeight / 2,
    CALLOUT_MARGIN,
    maxTop,
  );
  const centeredLeft = clamp(
    viewport.w / 2 - cardWidth / 2,
    CALLOUT_MARGIN,
    maxLeft,
  );

  if (isCentered || !targetRect) {
    return { top: centeredTop, left: centeredLeft };
  }

  const spaceAbove = targetRect.top;
  const spaceBelow = viewport.h - (targetRect.top + targetRect.height);
  const spaceRight = viewport.w - (targetRect.left + targetRect.width);
  const spaceLeft = targetRect.left;

  // Each "can" checks: (a) enough room for the card, (b) plus the
  // gap that keeps it visually detached from the target's halo.
  const canRight =
    spaceRight >= cardWidth + CALLOUT_TARGET_GAP + CALLOUT_MARGIN;
  const canLeft =
    spaceLeft >= cardWidth + CALLOUT_TARGET_GAP + CALLOUT_MARGIN;
  const canBottom =
    spaceBelow >= cardHeight + CALLOUT_TARGET_GAP + CALLOUT_MARGIN;
  const canAbove =
    spaceAbove >= cardHeight + CALLOUT_TARGET_GAP + CALLOUT_MARGIN;

  // Anchored steps never fall back to `centered` — that lets the
  // callout drift off the target and became the overlap bug in the
  // screenshots. Instead: pick the side with the most space if the
  // preferred one is too tight, and always clamp.
  let placement: 'top' | 'bottom' | 'left' | 'right' = 'bottom';
  const pref = preferred ?? 'bottom';
  if (pref === 'right' && canRight) placement = 'right';
  else if (pref === 'left' && canLeft) placement = 'left';
  else if (pref === 'top' && canAbove) placement = 'top';
  else if (pref === 'bottom' && canBottom) placement = 'bottom';
  else {
    // Fallback: pick whichever side has the most space.
    type Placement = 'top' | 'bottom' | 'left' | 'right';
    const spaces: Array<[Placement, number]> = [
      ['top', spaceAbove],
      ['bottom', spaceBelow],
      ['right', spaceRight],
      ['left', spaceLeft],
    ];
    spaces.sort((a, b) => b[1] - a[1]);
    const best = spaces[0];
    if (best) placement = best[0];
  }

  const centerX = targetRect.left + targetRect.width / 2;
  const centerY = targetRect.top + targetRect.height / 2;
  const targetRight = targetRect.left + targetRect.width;
  const targetBottom = targetRect.top + targetRect.height;

  let top: number;
  let left: number;
  if (placement === 'right') {
    top = clamp(centerY - cardHeight / 2, CALLOUT_MARGIN, maxTop);
    left = clamp(targetRight + CALLOUT_TARGET_GAP, CALLOUT_MARGIN, maxLeft);
  } else if (placement === 'left') {
    top = clamp(centerY - cardHeight / 2, CALLOUT_MARGIN, maxTop);
    left = clamp(
      targetRect.left - cardWidth - CALLOUT_TARGET_GAP,
      CALLOUT_MARGIN,
      maxLeft,
    );
  } else if (placement === 'top') {
    top = clamp(
      targetRect.top - cardHeight - CALLOUT_TARGET_GAP,
      CALLOUT_MARGIN,
      maxTop,
    );
    left = clamp(centerX - cardWidth / 2, CALLOUT_MARGIN, maxLeft);
  } else {
    // bottom
    top = clamp(targetBottom + CALLOUT_TARGET_GAP, CALLOUT_MARGIN, maxTop);
    left = clamp(centerX - cardWidth / 2, CALLOUT_MARGIN, maxLeft);
  }

  // Belt-and-braces: if the clamped position overlaps the target
  // (can happen at very tight viewports where the clamp forced the
  // card back into the target's row), push it to the axis with the
  // most free space.
  if (rectsOverlap({ top, left, width: cardWidth, height: cardHeight }, targetRect)) {
    // Try each side in order of most-space-first.
    const options: Array<{ top: number; left: number; space: number }> = [
      {
        top: clamp(targetRect.top - cardHeight - CALLOUT_TARGET_GAP, CALLOUT_MARGIN, maxTop),
        left: clamp(centerX - cardWidth / 2, CALLOUT_MARGIN, maxLeft),
        space: spaceAbove,
      },
      {
        top: clamp(targetBottom + CALLOUT_TARGET_GAP, CALLOUT_MARGIN, maxTop),
        left: clamp(centerX - cardWidth / 2, CALLOUT_MARGIN, maxLeft),
        space: spaceBelow,
      },
      {
        top: clamp(centerY - cardHeight / 2, CALLOUT_MARGIN, maxTop),
        left: clamp(targetRight + CALLOUT_TARGET_GAP, CALLOUT_MARGIN, maxLeft),
        space: spaceRight,
      },
      {
        top: clamp(centerY - cardHeight / 2, CALLOUT_MARGIN, maxTop),
        left: clamp(targetRect.left - cardWidth - CALLOUT_TARGET_GAP, CALLOUT_MARGIN, maxLeft),
        space: spaceLeft,
      },
    ];
    options.sort((a, b) => b.space - a.space);
    for (const opt of options) {
      if (!rectsOverlap({ top: opt.top, left: opt.left, width: cardWidth, height: cardHeight }, targetRect)) {
        return { top: opt.top, left: opt.left };
      }
    }
    // Everything overlapped (extremely tight viewport). Fall through
    // to the last-resort centered placement — the SVG spotlight is
    // still visible so the user sees the target through the cutout.
    return { top: centeredTop, left: centeredLeft };
  }

  return { top, left };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Find the first element matching `selector` that is actually laid
 * out on screen — non-zero client rect + non-null offsetParent.
 *
 * Rationale (v0.5.13): the mobile drawer flow exposes the same
 * `data-tour-id="nav-alerts"` anchor on multiple rails at once —
 * ProductSidebar is `hidden lg:flex` (still in DOM at `display: none`
 * on mobile), predict-shell's LeftRail is remounted inside the drawer,
 * and mobile-app-nav has its own `DrawerLink`. Naive `querySelector`
 * returns the first DOM match — which often is the hidden desktop
 * copy — and `getBoundingClientRect()` returns 0x0. The tour would
 * then render no cutout even though the visible drawer entry sits
 * right there. This helper iterates all matches and picks the first
 * one that's actually rendered so the spotlight tracks the copy the
 * user sees.
 */
function findVisibleTarget(selector: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const candidates = document.querySelectorAll<HTMLElement>(selector);
  for (const candidate of Array.from(candidates)) {
    // `offsetParent === null` covers the `display: none` chain in
    // Tailwind's `hidden` utility. `<body>` itself has a null
    // offsetParent by spec — allow it as a fallback so we don't
    // reject a legitimate body-level target.
    if (candidate.offsetParent === null && candidate.tagName !== 'BODY') {
      continue;
    }
    const r = candidate.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return candidate;
  }
  return null;
}

/**
 * WelcomeIconRow — horizontal row of overlapping icons on the tour
 * welcome step. Matches the reference (image 127) where a stack of
 * partner-logo circles sits above the "Welcome to …" title.
 *
 * Composition: Vizzor mark on the left, then BTC, ETH, SOL, GRAM
 * — the four native chain / topic pills the wallet works with in
 * this cut. Each icon sits inside a white ring so overlapping
 * neighbors read as separate coins rather than blending.
 */
function WelcomeIconRow() {
  const icons: Array<{ key: string; content: React.ReactNode }> = [
    {
      key: 'vizzor',
      /**
       * Transparent Vizzor mark — no background pill, no color
       * filter. `vizzor_icon.png` (white glyph on transparent) for
       * dark theme; `vizzor_darkicon.png` (dark glyph on
       * transparent) for light theme. Matches how the CoinIcon
       * pieces render — the outer `ring-2 ring-[var(--surface)]`
       * wrapper adds the separator ring, not the icon itself.
       */
      content: (
        <>
          <Image
            src="/brand/vizzor_icon.png"
            alt=""
            width={32}
            height={32}
            className="hidden dark:block h-8 w-8 object-contain"
          />
          <Image
            src="/brand/vizzor_darkicon.png"
            alt=""
            width={32}
            height={32}
            className="block dark:hidden h-8 w-8 object-contain"
          />
        </>
      ),
    },
    { key: 'btc', content: <CoinIcon symbol="BTC" size={32} /> },
    { key: 'eth', content: <CoinIcon symbol="ETH" size={32} /> },
    { key: 'sol', content: <CoinIcon symbol="SOL" size={32} /> },
    { key: 'gram', content: <CoinIcon symbol="GRAM" size={32} /> },
  ];
  return (
    <div aria-hidden className="flex items-center -space-x-2">
      {icons.map((icon) => (
        <span
          key={icon.key}
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-full',
            'ring-2 ring-[var(--surface)] bg-[var(--surface)]',
          )}
        >
          {icon.content}
        </span>
      ))}
    </div>
  );
}
