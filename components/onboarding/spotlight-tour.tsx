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
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTour } from './tour-provider';
import { stepsFor, type TourStep } from './tour-steps';
import { markTourCompleted } from '@/lib/onboarding/tour-storage';

const CALLOUT_WIDTH = 320;
const CALLOUT_HEIGHT_ESTIMATE = 200;
const CALLOUT_MARGIN = 16;
/**
 * How far the callout stays away from the target rect. Includes
 * SPOTLIGHT_PADDING (the halo we already draw around the target) plus
 * a visual gap so the callout never appears to touch the target.
 */
const CALLOUT_TARGET_GAP = 20;
const SPOTLIGHT_PADDING = 8;
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
    const compute = () => {
      const el = document.querySelector<HTMLElement>(step.targetSelector!);
      if (!el) {
        setTargetRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setTargetRect({
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
      });
    };
    compute();
    const retryId = window.setTimeout(compute, 100);
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.clearTimeout(retryId);
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
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

  // v0.5.8 — `requiresClick` steps: advance the tour only when the
  // user actually clicks the target element. This is the gate for
  // the mobile-menu step so we can't skip past a closed drawer.
  // The SVG backdrop is pointer-events: none, so clicks reach the
  // target normally + fire its own onClick handler (which opens
  // the drawer) alongside our listener (which advances the tour).
  useEffect(() => {
    if (!isOpen || !step?.requiresClick || !step.targetSelector) return;
    const el = document.querySelector<HTMLElement>(step.targetSelector);
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

  const progressPct = ((clampedIndex + 1) / total) * 100;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vz-tour-title"
      className="fixed inset-0 z-[90] motion-safe:vz-spotlight-mask-in"
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
      <svg
        aria-hidden
        width={viewport.w}
        height={viewport.h}
        className="fixed inset-0"
        style={{ pointerEvents: 'none' }}
      >
        <defs>
          <mask id="vz-tour-mask">
            <rect
              x={0}
              y={0}
              width={viewport.w}
              height={viewport.h}
              fill="white"
            />
            <rect
              className="vz-tour-spotlight-rect"
              x={spotlight.x}
              y={spotlight.y}
              width={spotlight.width}
              height={spotlight.height}
              rx={12}
              fill="black"
            />
          </mask>
        </defs>
        <rect
          x={0}
          y={0}
          width={viewport.w}
          height={viewport.h}
          fill="rgba(0, 0, 0, 0.68)"
          mask="url(#vz-tour-mask)"
        />
        {/* Subtle static outline around the cutout — no pulse, no
            accent color. Just a hairline delineation so the target
            reads as bounded without any "shine". User feedback:
            the accent-colored pulsing ring was too shiny. */}
        {targetRect && !isCentered && (
          <rect
            className="vz-tour-spotlight-rect"
            x={spotlight.x}
            y={spotlight.y}
            width={spotlight.width}
            height={spotlight.height}
            rx={12}
            fill="none"
            stroke="color-mix(in oklab, var(--fg) 22%, transparent)"
            strokeWidth={1}
          />
        )}
        {/* Swipe-hint pointer — a small circle that slides across
            the width of the spotlight. Positioned via cx/cy SVG
            attributes (which the browser respects); animation is a
            CSS `transform: translateX(...)` on the circle itself.
            Using a <g> wrapper with a `transform` attribute was
            incorrect — the CSS transform on the group overwrote
            the SVG position and dumped the pointer at (0,0). */}
        {targetRect && !isCentered && step.showSwipeHint && (
          <circle
            className="vz-tour-swipe-hint"
            cx={spotlight.x + 14}
            cy={spotlight.y + spotlight.height / 2}
            r={7}
            fill="color-mix(in oklab, var(--fg) 25%, transparent)"
            stroke="color-mix(in oklab, var(--fg) 55%, transparent)"
            strokeWidth={1.2}
            style={
              {
                ['--swipe-distance']: `${Math.max(0, spotlight.width - 28)}px`,
              } as React.CSSProperties
            }
          />
        )}
      </svg>

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
        }}
        className={cn(
          'vz-tour-callout',
          'rounded-xl',
          'bg-[var(--surface)]',
          'border border-[var(--border)]',
          'focus:outline-none',
          'motion-safe:vz-tour-callout-in',
        )}
      >
        <div ref={contentRef} className="vz-tour-content-in p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="mono tabular text-[10px] uppercase tracking-[0.22em] text-[var(--fg-3)]">
              {t('stepIndicator', {
                index: clampedIndex + 1,
                total,
              })}
            </span>
            <button
              type="button"
              onClick={onFinish}
              aria-label={t('skip')}
              className={cn(
                'inline-flex items-center justify-center h-6 w-6 -mr-1 rounded-md',
                'text-[var(--fg-3)] hover:text-[var(--fg)]',
                'hover:bg-[color-mix(in_oklab,var(--fg)_6%,transparent)]',
                'transition-colors',
              )}
            >
              <X size={14} strokeWidth={2} aria-hidden />
            </button>
          </div>

          <h2
            id="vz-tour-title"
            className="mt-2.5 text-[15px] font-semibold tracking-tight text-[var(--fg)] leading-snug break-words"
          >
            {stepTitle}
          </h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--fg-2)] break-words">
            {stepBody}
          </p>

          {/* Progress: segmented bar. One segment per step, filled up
              to the current index. Reads as a step counter, not a
              carousel dot pattern. */}
          <div className="mt-4 flex items-center gap-1">
            {Array.from({ length: total }).map((_, i) => (
              <span
                key={i}
                aria-hidden
                className={cn(
                  'h-[3px] flex-1 rounded-full',
                  'transition-colors duration-300',
                  i <= clampedIndex
                    ? 'bg-[var(--fg-2)]'
                    : 'bg-[color-mix(in_oklab,var(--fg)_10%,transparent)]',
                )}
              />
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="mono tabular text-[9px] uppercase tracking-[0.22em] text-[var(--fg-3)]">
              {progressPct.toFixed(0)}%
            </span>
            <span className="mono tabular text-[9.5px] uppercase tracking-[0.24em] text-[var(--fg-3)]">
              {step.id}
            </span>
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={prev}
              disabled={isFirst}
              className={cn(
                'inline-flex items-center justify-center h-7 px-2 rounded-md',
                'mono tabular text-[10px] uppercase tracking-[0.16em]',
                'text-[var(--fg-3)] hover:text-[var(--fg)]',
                'hover:bg-[color-mix(in_oklab,var(--fg)_5%,transparent)]',
                'disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed',
                'transition-colors',
              )}
            >
              {t('previous')}
            </button>
            {step.requiresClick ? (
              /* Require-click gate: no Next button. The tour only
                 advances when the user actually clicks the target
                 (see useEffect wiring above). A pulsing hint keeps
                 the affordance readable. */
              <span
                className={cn(
                  'inline-flex items-center gap-1',
                  'mono tabular text-[10px] uppercase tracking-[0.16em]',
                  'text-[var(--fg-3)]',
                  'motion-safe:vz-tap-hint',
                )}
              >
                {t.has('tapToContinue' as never)
                  ? (t as unknown as (k: string) => string)('tapToContinue')
                  : 'Tap to continue'}
              </span>
            ) : (
              <button
                type="button"
                onClick={onNextClick}
                className={cn(
                  'inline-flex items-center justify-center h-7 px-3 rounded-md',
                  'mono tabular text-[10px] font-semibold uppercase tracking-[0.16em]',
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
