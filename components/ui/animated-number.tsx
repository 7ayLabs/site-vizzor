'use client';

/**
 * <AnimatedNumber value={108420} format="usd" /> — tweens its display value
 * smoothly when `value` changes. On first mount, counts up from 0.
 *
 * Uses requestAnimationFrame for the tween; tabular-nums on the rendered
 * text prevents layout shift digit-by-digit. Respects prefers-reduced-motion
 * by snapping to the final value with no animation.
 */

import { useEffect, useRef, useState } from 'react';

type Format = 'usd' | 'pct' | 'int' | 'plain';

interface AnimatedNumberProps {
  value: number;
  format?: Format;
  duration?: number; // ms
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

function formatNumber(n: number, fmt: Format, decimals?: number): string {
  switch (fmt) {
    case 'usd': {
      if (n >= 1000)
        return `$${n.toLocaleString('en-US', {
          maximumFractionDigits: decimals ?? 0,
        })}`;
      if (n >= 1) return `$${n.toFixed(decimals ?? 2)}`;
      if (n >= 0.01) return `$${n.toFixed(decimals ?? 4)}`;
      return `$${n.toPrecision(3)}`;
    }
    case 'pct':
      return `${n.toFixed(decimals ?? 1)}%`;
    case 'int':
      return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    case 'plain':
    default:
      return n.toFixed(decimals ?? 2);
  }
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

export function AnimatedNumber({
  value,
  format = 'plain',
  duration = 800,
  decimals,
  prefix,
  suffix,
  className,
}: AnimatedNumberProps) {
  // Respect reduced-motion: snap to final value, no tween.
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const [display, setDisplay] = useState<number>(reducedMotion ? value : 0);
  const prevRef = useRef<number>(reducedMotion ? value : 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reducedMotion) {
      setDisplay(value);
      prevRef.current = value;
      return;
    }

    const from = prevRef.current;
    const to = value;
    const start = performance.now();

    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutCubic(t);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        prevRef.current = to;
        rafRef.current = null;
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration, reducedMotion]);

  return (
    <span className={`tabular ${className ?? ''}`}>
      {prefix}
      {formatNumber(display, format, decimals)}
      {suffix}
    </span>
  );
}
