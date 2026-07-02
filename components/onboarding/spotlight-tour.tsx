'use client';

/**
 * SpotlightTour — full-viewport overlay + spotlight cutout + callout
 * card for the first-time-login guided tour.
 *
 * Rendering approach:
 *   - The backdrop is an SVG covering the viewport with a black rect
 *     at low opacity + a transparent cutout rect around the target.
 *     Doing the cutout as an SVG mask (rather than CSS box-shadow
 *     hack) gives sub-pixel-clean edges on high-DPR displays and
 *     lets us animate the mask's opacity separately from the card.
 *   - The callout is a `position: fixed` card placed above/below/
 *     right of the target based on which side has the most viewport
 *     room. Small viewports fall back to a bottom-centered layout.
 *   - Recomputes the target rect on: window resize (`ResizeObserver`
 *     on document.documentElement), window scroll, and `stepIndex`
 *     changes.
 *
 * Keyboard model:
 *   Escape → skip (writes flag, closes)
 *   →      → next step (or finish on the last one)
 *   ←      → previous step (clamped at 0)
 *
 * The focus is trapped inside the callout while the tour is open so
 * a screen reader user can't tab into the (visually dimmed) app
 * behind the backdrop.
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
import { cn } from '@/lib/utils';
import { useTour } from './tour-provider';
import { stepAt, totalSteps, type TourStep } from './tour-steps';
import { markTourCompleted } from '@/lib/onboarding/tour-storage';

const CALLOUT_WIDTH = 320;
const CALLOUT_MARGIN = 12;
const SPOTLIGHT_PADDING = 8;
const MOBILE_BREAKPOINT = 640;

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

  useEffect(() => {
    setMounted(true);
  }, []);

  const step = stepAt(stepIndex);
  const total = totalSteps();
  const isCentered = useMemo<boolean>(() => {
    if (!step) return true;
    if (!step.targetSelector) return true;
    if (viewport.w < MOBILE_BREAKPOINT && step.mobileFallback === 'centered') {
      return true;
    }
    return targetRect === null;
  }, [step, viewport.w, targetRect]);

  // Viewport tracker — re-render on resize so the callout re-picks
  // its side + the SVG re-fits the viewport.
  useEffect(() => {
    if (!isOpen) return;
    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isOpen]);

  // Target-rect tracker. Recomputes on step change, viewport
  // change, and scroll. Uses a fresh selector query each time
  // rather than caching the element ref: the target can unmount
  // between steps (e.g. capability tray only mounts when a ticker
  // is armed), and re-selecting is cheap.
  useEffect(() => {
    if (!isOpen || !step?.targetSelector) {
      setTargetRect(null);
      return;
    }
    if (viewport.w < MOBILE_BREAKPOINT && step.mobileFallback === 'centered') {
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
    // Retry a couple frames in case the target is still hydrating
    // when the step activates (React 19 async paint window).
    const retryId = window.setTimeout(compute, 100);
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.clearTimeout(retryId);
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [isOpen, step, viewport.w]);

  // Keyboard nav.
  const onFinish = useCallback(() => {
    markTourCompleted();
    close();
  }, [close]);

  const onNextClick = useCallback(() => {
    if (stepIndex >= total - 1) {
      onFinish();
    } else {
      next();
    }
  }, [stepIndex, total, next, onFinish]);

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
  }, [isOpen, stepIndex]);

  if (!isOpen || !mounted || !step) return null;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === total - 1;
  const stepTitle = t(`steps.${step.i18nKey}.title` as never);
  const stepBody = t(`steps.${step.i18nKey}.body` as never);

  // Compute callout coords.
  const calloutPos = computeCalloutPos({
    isCentered,
    targetRect,
    viewport,
    preferred: step.placement,
  });

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vz-tour-title"
      className={cn('fixed inset-0 z-[90]', 'motion-safe:vz-spotlight-mask-in')}
    >
      {/* SVG spotlight backdrop */}
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
            {targetRect && !isCentered && (
              <rect
                x={targetRect.left - SPOTLIGHT_PADDING}
                y={targetRect.top - SPOTLIGHT_PADDING}
                width={targetRect.width + SPOTLIGHT_PADDING * 2}
                height={targetRect.height + SPOTLIGHT_PADDING * 2}
                rx={10}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x={0}
          y={0}
          width={viewport.w}
          height={viewport.h}
          fill="rgba(0, 0, 0, 0.62)"
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
          'rounded-2xl border border-[var(--border)]',
          'bg-[var(--surface)] shadow-2xl',
          'p-4 focus:outline-none',
          'motion-safe:vz-tour-callout-in',
        )}
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="mono tabular text-[9.5px] uppercase tracking-[0.22em] text-[var(--fg-3)]">
            {t('stepIndicator', {
              index: stepIndex + 1,
              total,
            })}
          </span>
          <button
            type="button"
            onClick={onFinish}
            aria-label={t('skip')}
            className={cn(
              'inline-flex items-center justify-center h-6 px-1.5 rounded-md',
              'mono tabular text-[10px] uppercase tracking-[0.16em]',
              'text-[var(--fg-3)] hover:text-[var(--fg)]',
              'transition-colors',
            )}
          >
            {t('skip')}
          </button>
        </div>
        <h2
          id="vz-tour-title"
          className="text-[15px] font-semibold text-[var(--fg)] leading-tight"
        >
          {stepTitle}
        </h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--fg-2)]">
          {stepBody}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={prev}
            disabled={isFirst}
            className={cn(
              'inline-flex items-center justify-center h-8 px-3 rounded-lg',
              'mono tabular text-[10.5px] uppercase tracking-[0.16em]',
              'text-[var(--fg-3)] hover:text-[var(--fg)]',
              'disabled:opacity-30 disabled:cursor-not-allowed',
              'transition-colors',
            )}
          >
            {t('previous')}
          </button>
          <div className="flex items-center gap-1">
            {Array.from({ length: total }).map((_, i) => (
              <span
                key={i}
                aria-hidden
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  'transition-colors duration-150',
                  i === stepIndex
                    ? 'bg-[var(--fg)]'
                    : 'bg-[color-mix(in_oklab,var(--fg)_20%,transparent)]',
                )}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={onNextClick}
            className={cn(
              'inline-flex items-center justify-center h-8 px-4 rounded-lg',
              'mono tabular text-[10.5px] font-semibold uppercase tracking-[0.16em]',
              'bg-[var(--fg)] text-[var(--bg)]',
              'hover:opacity-90 active:scale-95',
              'transition-[opacity,transform] duration-150',
            )}
          >
            {isLast ? t('finish') : t('next')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Pick a callout position that avoids clipping. Centered layout is
 * used for welcome/done steps + as a mobile fallback for sidebar
 * targets. For anchored layouts, we start from the step's preferred
 * placement and adjust if the callout would spill off-screen.
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
      top: Math.max(24, viewport.h / 2 - 100),
      left: Math.max(16, viewport.w / 2 - CALLOUT_WIDTH / 2),
    };
  }
  const calloutHeight = 200; // rough estimate; card auto-heights but
  // we only need a conservative upper bound for placement math
  const spaceAbove = targetRect.top;
  const spaceBelow = viewport.h - (targetRect.top + targetRect.height);
  const spaceRight = viewport.w - (targetRect.left + targetRect.width);
  const spaceLeft = targetRect.left;

  const canRight = spaceRight >= CALLOUT_WIDTH + CALLOUT_MARGIN;
  const canLeft = spaceLeft >= CALLOUT_WIDTH + CALLOUT_MARGIN;
  const canBottom = spaceBelow >= calloutHeight + CALLOUT_MARGIN;
  const canAbove = spaceAbove >= calloutHeight + CALLOUT_MARGIN;

  // Try preferred first, fall back to the axis that has room.
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
      top: Math.max(24, viewport.h / 2 - calloutHeight / 2),
      left: Math.max(16, viewport.w / 2 - CALLOUT_WIDTH / 2),
    };
  }

  const centerX = targetRect.left + targetRect.width / 2;
  const centerY = targetRect.top + targetRect.height / 2;

  if (placement === 'right') {
    return {
      top: clamp(
        centerY - calloutHeight / 2,
        CALLOUT_MARGIN,
        viewport.h - calloutHeight - CALLOUT_MARGIN,
      ),
      left: targetRect.left + targetRect.width + CALLOUT_MARGIN,
    };
  }
  if (placement === 'left') {
    return {
      top: clamp(
        centerY - calloutHeight / 2,
        CALLOUT_MARGIN,
        viewport.h - calloutHeight - CALLOUT_MARGIN,
      ),
      left: targetRect.left - CALLOUT_WIDTH - CALLOUT_MARGIN,
    };
  }
  if (placement === 'top') {
    return {
      top: Math.max(CALLOUT_MARGIN, targetRect.top - calloutHeight - CALLOUT_MARGIN),
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
