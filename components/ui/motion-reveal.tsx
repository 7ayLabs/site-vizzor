/**
 * MotionReveal — IntersectionObserver-based reveal-on-scroll wrapper.
 *
 * When the element first crosses the viewport it animates from
 * (opacity 0, translateY(`distance`px)) to its resting state over 200ms
 * ease-out. Triggered once; subsequent scroll passes are no-ops.
 *
 * For `prefers-reduced-motion: reduce` users we skip the IO entirely and
 * mount in the final state — no transform, no transition, no flash. The
 * global reduced-motion rule in globals.css collapses transition-duration
 * but we want to also avoid the initial offset translation, which is why
 * we set the resting state up-front rather than relying on the global rule.
 *
 * Vanilla IntersectionObserver — no library dependency.
 */
'use client';

import { useEffect, useRef, useState, createElement } from 'react';

export interface MotionRevealProps {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  as?: keyof React.JSX.IntrinsicElements;
}

export function MotionReveal({
  children,
  delay = 0,
  distance = 8,
  as = 'div',
}: MotionRevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);
  const [visible, setVisible] = useState<boolean>(false);

  // Detect reduced-motion preference once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setVisible(true);
      return;
    }
    const node = ref.current;
    if (!node) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.05, rootMargin: '0px 0px -5% 0px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [reducedMotion]);

  const inFinalState = reducedMotion || visible;

  const style: React.CSSProperties = reducedMotion
    ? {}
    : {
        opacity: inFinalState ? 1 : 0,
        transform: inFinalState ? 'translateY(0)' : `translateY(${distance}px)`,
        transition: 'opacity 200ms ease-out, transform 200ms ease-out',
        transitionDelay: `${delay}ms`,
        willChange: inFinalState ? 'auto' : 'opacity, transform',
      };

  return createElement(
    as,
    {
      ref: ref as React.Ref<HTMLElement>,
      style,
    },
    children,
  );
}
