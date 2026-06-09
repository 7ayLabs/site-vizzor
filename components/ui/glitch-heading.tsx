/**
 * GlitchHeading — 200ms RGB-split heading reveal on intersect.
 *
 * Cheap, vanilla-IO triggered text-shadow animation; no GSAP dependency
 * because the effect is too small to justify the timeline overhead.
 * Reduced-motion users skip the effect and render a plain heading —
 * the gated CSS is removed entirely so they don't see a stuck split.
 *
 * Polychromatic split uses the accent (mint) and danger (red) tokens
 * so the colors flow with theme changes.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useReducedMotionSafe } from '@/lib/motion';

export interface GlitchHeadingProps {
  as?: 'h1' | 'h2' | 'h3';
  children: React.ReactNode;
  className?: string;
}

export function GlitchHeading({
  as = 'h2',
  children,
  className,
}: GlitchHeadingProps) {
  const reduced = useReducedMotionSafe();
  const ref = useRef<HTMLHeadingElement | null>(null);
  const [glitching, setGlitching] = useState<boolean>(false);

  useEffect(() => {
    if (reduced) return;
    const node = ref.current;
    if (!node) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setGlitching(true);
            // 200ms effect window — clear and let the heading settle.
            const timeout = window.setTimeout(() => {
              setGlitching(false);
            }, 200);
            io.disconnect();
            return () => window.clearTimeout(timeout);
          }
        }
      },
      { threshold: 0.4, rootMargin: '0px 0px -10% 0px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [reduced]);

  const Tag = as;

  // Two-color RGB split via text-shadow. Removed entirely under reduced
  // motion so the heading paints crisp from the first frame.
  const style: React.CSSProperties =
    !reduced && glitching
      ? {
          textShadow:
            '1px 0 0 var(--accent), -1px 0 0 var(--danger)',
          transition: 'text-shadow 200ms steps(3, end)',
        }
      : {};

  return (
    <Tag ref={ref} className={cn(className)} style={style}>
      {children}
    </Tag>
  );
}
