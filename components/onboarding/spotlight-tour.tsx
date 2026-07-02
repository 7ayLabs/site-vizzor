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

const CALLOUT_WIDTH = 340;
const CALLOUT_HEIGHT_ESTIMATE = 208;
const CALLOUT_MARGIN = 14;
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
  });

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
      {/* SVG spotlight backdrop. Animating the rect via CSS
          transitions on x/y/width/height gives us a smooth aperture
          morph between steps. */}
      <svg
        aria-hidden
        width={viewport.w}
        height={viewport.h}
        className="fixed inset-0"
        style={{ pointerEvents: 'auto' }}
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
      </svg>

      {/* Callout card */}
      <div
        ref={calloutRef}
        tabIndex={-1}
        style={{
          position: 'fixed',
          top: calloutPos.top,
          left: calloutPos.left,
          width: CALLOUT_WIDTH,
        }}
        className={cn(
          'vz-tour-callout',
          'overflow-hidden rounded-2xl',
          'bg-[var(--surface)]',
          'border border-[color-mix(in_oklab,var(--fg)_10%,var(--border))]',
          'focus:outline-none',
          'motion-safe:vz-tour-callout-in',
        )}
      >
        {/* Top accent bar — thin gradient stripe. Reads as a system
            dialog "handle" without competing with the content. */}
        <div
          aria-hidden
          className={cn(
            'h-[3px] w-full',
            'bg-gradient-to-r from-[var(--accent)] via-[color-mix(in_oklab,var(--accent)_60%,var(--fg))] to-[var(--fg)]',
          )}
        />

        <div ref={contentRef} className="vz-tour-content-in p-5">
          <div className="flex items-start justify-between gap-3">
            <span className="mono tabular text-[10px] uppercase tracking-[0.24em] text-[var(--fg-3)]">
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
                'inline-flex items-center justify-center h-6 w-6 -mr-1 -mt-1 rounded-md',
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
            className="mt-3 display text-[17px] sm:text-[18px] font-semibold tracking-tight text-[var(--fg)] leading-tight"
          >
            {stepTitle}
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--fg-2)]">
            {stepBody}
          </p>

          {/* Progress: dots + a thin underline that fills as steps
              advance. Reads more "map" than "carousel". */}
          <div className="mt-5 flex items-center gap-2">
            {Array.from({ length: total }).map((_, i) => (
              <span
                key={i}
                aria-hidden
                className={cn(
                  'h-1 flex-1 rounded-full',
                  'transition-colors duration-300',
                  i <= clampedIndex
                    ? 'bg-[var(--fg)]'
                    : 'bg-[color-mix(in_oklab,var(--fg)_14%,transparent)]',
                )}
              />
            ))}
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="mono tabular text-[9.5px] uppercase tracking-[0.24em] text-[var(--fg-3)]">
              {progressPct.toFixed(0)}%
            </span>
            <span className="mono tabular text-[9.5px] uppercase tracking-[0.24em] text-[var(--fg-3)]">
              {step.id}
            </span>
          </div>

          <div className="mt-5 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={prev}
              disabled={isFirst}
              className={cn(
                'inline-flex items-center justify-center h-8 px-2 rounded-md',
                'mono tabular text-[10.5px] uppercase tracking-[0.18em]',
                'text-[var(--fg-3)] hover:text-[var(--fg)]',
                'hover:bg-[color-mix(in_oklab,var(--fg)_5%,transparent)]',
                'disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed',
                'transition-colors',
              )}
            >
              {t('previous')}
            </button>
            <button
              type="button"
              onClick={onNextClick}
              className={cn(
                'inline-flex items-center justify-center h-8 px-4 rounded-md',
                'mono tabular text-[10.5px] font-semibold uppercase tracking-[0.18em]',
                'bg-[var(--fg)] text-[var(--bg)]',
                'hover:opacity-90 active:scale-[0.98]',
                'transition-[opacity,transform] duration-150',
              )}
            >
              {isLast ? t('finish') : t('next')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Pick a callout position that avoids clipping. Centered layout is
 * used for welcome/done + mobile fallbacks. For anchored layouts,
 * we start from the step's preferred placement and re-choose if the
 * callout would spill off-screen.
 */
function computeCalloutPos({
  isCentered,
  targetRect,
  viewport,
  preferred,
}: {
  isCentered: boolean;
  targetRect: Rect | null;
  viewport: { w: number; h: number };
  preferred: TourStep['placement'];
}): { top: number; left: number } {
  if (isCentered || !targetRect) {
    return {
      top: Math.max(24, viewport.h / 2 - CALLOUT_HEIGHT_ESTIMATE / 2),
      left: Math.max(16, viewport.w / 2 - CALLOUT_WIDTH / 2),
    };
  }
  const spaceAbove = targetRect.top;
  const spaceBelow = viewport.h - (targetRect.top + targetRect.height);
  const spaceRight = viewport.w - (targetRect.left + targetRect.width);
  const spaceLeft = targetRect.left;

  const canRight = spaceRight >= CALLOUT_WIDTH + CALLOUT_MARGIN;
  const canLeft = spaceLeft >= CALLOUT_WIDTH + CALLOUT_MARGIN;
  const canBottom = spaceBelow >= CALLOUT_HEIGHT_ESTIMATE + CALLOUT_MARGIN;
  const canAbove = spaceAbove >= CALLOUT_HEIGHT_ESTIMATE + CALLOUT_MARGIN;

  let placement: TourStep['placement'] = preferred ?? 'bottom';
  if (placement === 'right' && !canRight) {
    placement = canBottom ? 'bottom' : canAbove ? 'top' : 'centered';
  } else if (placement === 'left' && !canLeft) {
    placement = canBottom ? 'bottom' : canAbove ? 'top' : 'centered';
  } else if (placement === 'top' && !canAbove) {
    placement = canBottom ? 'bottom' : canRight ? 'right' : 'centered';
  } else if (placement === 'bottom' && !canBottom) {
    placement = canAbove ? 'top' : canRight ? 'right' : 'centered';
  }

  if (placement === 'centered') {
    return {
      top: Math.max(24, viewport.h / 2 - CALLOUT_HEIGHT_ESTIMATE / 2),
      left: Math.max(16, viewport.w / 2 - CALLOUT_WIDTH / 2),
    };
  }

  const centerX = targetRect.left + targetRect.width / 2;
  const centerY = targetRect.top + targetRect.height / 2;

  if (placement === 'right') {
    return {
      top: clamp(
        centerY - CALLOUT_HEIGHT_ESTIMATE / 2,
        CALLOUT_MARGIN,
        viewport.h - CALLOUT_HEIGHT_ESTIMATE - CALLOUT_MARGIN,
      ),
      left: targetRect.left + targetRect.width + CALLOUT_MARGIN,
    };
  }
  if (placement === 'left') {
    return {
      top: clamp(
        centerY - CALLOUT_HEIGHT_ESTIMATE / 2,
        CALLOUT_MARGIN,
        viewport.h - CALLOUT_HEIGHT_ESTIMATE - CALLOUT_MARGIN,
      ),
      left: targetRect.left - CALLOUT_WIDTH - CALLOUT_MARGIN,
    };
  }
  if (placement === 'top') {
    return {
      top: Math.max(
        CALLOUT_MARGIN,
        targetRect.top - CALLOUT_HEIGHT_ESTIMATE - CALLOUT_MARGIN,
      ),
      left: clamp(
        centerX - CALLOUT_WIDTH / 2,
        CALLOUT_MARGIN,
        viewport.w - CALLOUT_WIDTH - CALLOUT_MARGIN,
      ),
    };
  }
  // bottom
  return {
    top: targetRect.top + targetRect.height + CALLOUT_MARGIN,
    left: clamp(
      centerX - CALLOUT_WIDTH / 2,
      CALLOUT_MARGIN,
      viewport.w - CALLOUT_WIDTH - CALLOUT_MARGIN,
    ),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
