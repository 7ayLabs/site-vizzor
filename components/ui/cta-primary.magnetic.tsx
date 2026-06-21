/**
 * MagneticWrap — client wrapper that adds cursor-tracking translation
 * to whatever it contains (typically a CtaPrimary).
 *
 * Listens on a parent that covers an 80px hot zone around the button
 * via `pointer-events: none` on its own root + capture on the inner
 * element. Translation is rAF-batched and clamped to 8px max.
 *
 * Reduced-motion users (or environments without rAF) see no effect —
 * the wrapper renders children inline with no listeners attached.
 */
'use client';

import { useEffect, useRef } from 'react';
import { useReducedMotionSafe } from '@/lib/motion';

interface MagneticWrapProps {
  children: React.ReactNode;
}

const HOT_RADIUS = 80;
const MAX_LIFT = 8;

export function MagneticWrap({ children }: MagneticWrapProps) {
  const reduced = useReducedMotionSafe();
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const innerRef = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) return;
    const root = rootRef.current;
    const inner = innerRef.current;
    if (!root || !inner) return;

    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

    const tick = (): void => {
      currentX += (targetX - currentX) * 0.18;
      currentY += (targetY - currentY) * 0.18;
      inner.style.transform = `translate3d(${currentX.toFixed(2)}px, ${currentY.toFixed(2)}px, 0)`;
      if (Math.abs(targetX - currentX) > 0.05 || Math.abs(targetY - currentY) > 0.05) {
        rafRef.current = window.requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    const ensureLoop = (): void => {
      if (rafRef.current == null) {
        rafRef.current = window.requestAnimationFrame(tick);
      }
    };

    const onMove = (event: MouseEvent): void => {
      const rect = inner.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > HOT_RADIUS) {
        targetX = 0;
        targetY = 0;
      } else {
        const pull = 1 - dist / HOT_RADIUS;
        targetX = (dx / HOT_RADIUS) * MAX_LIFT * pull;
        targetY = (dy / HOT_RADIUS) * MAX_LIFT * pull;
      }
      ensureLoop();
    };

    const onLeave = (): void => {
      targetX = 0;
      targetY = 0;
      ensureLoop();
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    root.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      root.removeEventListener('mouseleave', onLeave);
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      inner.style.transform = '';
    };
  }, [reduced]);

  return (
    <span ref={rootRef} className="inline-block">
      <span
        ref={innerRef}
        className="inline-block will-change-transform"
        style={{ transition: 'transform 80ms linear' }}
      >
        {children}
      </span>
    </span>
  );
}
