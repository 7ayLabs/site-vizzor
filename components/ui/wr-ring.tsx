/**
 * WRRing — SVG circular progress ring for win-rate display. Stroke color
 * encodes "target met" semantics (accent when WR >= 65%, fg-3 otherwise).
 * Track is the standard border color so the unfilled arc disappears into
 * the surface. Mount animation runs via CSS keyframes on the dash offset;
 * the global prefers-reduced-motion rule in globals.css clamps the
 * duration to ~0ms so users who opt out see the final state immediately.
 */

import { useId } from 'react';
import { cn } from '@/lib/utils';

export interface WRRingProps {
  percent: number;
  samples: number;
  size?: number;
  label?: string;
}

const TARGET = 0.65;

function formatPercent(percent: number): string {
  return `${(percent * 100).toFixed(1)}%`;
}

function formatSamples(n: number): string {
  return `n=${n.toLocaleString('en-US')}`;
}

export function WRRing({ percent, samples, size = 140, label }: WRRingProps) {
  const reactId = useId();
  const animId = `wr-ring-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const clamped = Math.max(0, Math.min(1, percent));
  const strokeWidth = size / 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const target = circumference * (1 - clamped);
  const stroke = clamped >= TARGET ? 'var(--accent)' : 'var(--fg-3)';

  return (
    <div
      className="relative inline-flex flex-col items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Win rate ${formatPercent(clamped)} from ${samples.toLocaleString('en-US')} samples`}
    >
      <style>{`
        @keyframes ${animId} {
          from { stroke-dashoffset: ${circumference}; }
          to { stroke-dashoffset: ${target}; }
        }
      `}</style>

      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 -rotate-90"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{
            strokeDashoffset: target,
            animation: `${animId} 800ms ease-out`,
            transition: 'stroke 200ms ease',
          }}
        />
      </svg>

      <div className="relative z-10 flex flex-col items-center justify-center text-center leading-none">
        {label && (
          <span
            className={cn(
              'eyebrow mb-1',
              clamped >= TARGET ? '' : 'text-[var(--fg-3)]',
            )}
            style={clamped >= TARGET ? undefined : { color: 'var(--fg-3)' }}
          >
            {label}
          </span>
        )}
        <span
          className="mono tabular font-bold text-[var(--fg)]"
          style={{ fontSize: size * 0.2 }}
        >
          {formatPercent(clamped)}
        </span>
        <span
          className="mono tabular mt-1 text-[var(--fg-3)]"
          style={{ fontSize: size * 0.085 }}
        >
          {formatSamples(samples)}
        </span>
      </div>
    </div>
  );
}
