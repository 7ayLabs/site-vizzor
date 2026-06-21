/**
 * HowItWorksClient — three plain-language explanation cards.
 *
 * Pass 2 reframes the section away from engine diagnostics. Each card is now
 * a friendly explanation, not an instrument. The three mini-visuals match
 * the three steps a Web3-native trader takes:
 *
 *   1. Ask           : a chat-style prompt bubble
 *   2. Get a call    : a directional call-out card (arrow + confidence)
 *   3. Track the     : a tiny public-scoreboard tally (wins/misses/neutral)
 *      result
 *
 * Animation behaviour is unchanged — staggered GSAP reveal of the three
 * cards, all gated by `useReducedMotionSafe`. The mini-visuals each
 * render a static frame under reduced-motion.
 */
'use client';

import { useEffect, useRef } from 'react';
import { runGsapReveal, useReducedMotionSafe } from '@/lib/motion';
import { GlitchHeading } from '@/components/ui/glitch-heading';
import { LiveBadge } from '@/components/ui/live-badge';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { cn } from '@/lib/utils';

interface StepCopy {
  number: string;
  title: string;
  description: string;
}

export interface HowItWorksClientProps {
  steps: readonly [StepCopy, StepCopy, StepCopy];
  arrow: string;
}

export function HowItWorksClient({ steps, arrow }: HowItWorksClientProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<HTMLDivElement[]>([]);
  const reduced = useReducedMotionSafe();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const targets = cardRefs.current.filter(
      (el): el is HTMLDivElement => el !== null,
    );
    if (targets.length === 0) return;
    return runGsapReveal({
      root,
      targets,
      reduced,
      stagger: 0.12,
      duration: 0.55,
    });
  }, [reduced]);

  const setCardRef = (idx: number) => (el: HTMLDivElement | null): void => {
    if (el) cardRefs.current[idx] = el;
  };

  const visuals: readonly [React.ReactNode, React.ReactNode, React.ReactNode] = [
    <AskVisual key="v1" reduced={reduced} />,
    <CallVisual key="v2" reduced={reduced} />,
    <ScoreboardVisual key="v3" reduced={reduced} />,
  ];

  return (
    <div
      ref={rootRef}
      className="mt-20 grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] gap-8 md:gap-4 items-stretch"
    >
      {steps.map((step, idx) => {
        const isLast = idx === steps.length - 1;
        return (
          <div key={step.number} className="contents">
            <div
              ref={setCardRef(idx)}
              className={cn(
                'relative flex flex-col gap-5 p-6',
                'rounded-lg bg-[var(--surface)] border border-[var(--border-hi)]',
                'vt-bracket',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="mono tabular text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--gold)] leading-none">
                  {step.number}
                </span>
                <LiveBadge tone={idx === 2 ? 'gold' : 'mint'} />
              </div>

              <GlitchHeading
                as="h3"
                className="text-[22px] sm:text-[26px] font-bold tracking-tight text-[var(--fg)] leading-[1.15]"
              >
                {step.title}
              </GlitchHeading>

              <p className="text-[15px] leading-relaxed text-[var(--fg-2)]">
                {step.description}
              </p>

              <div className="mt-auto pt-2">{visuals[idx]}</div>
            </div>

            {!isLast && (
              <div
                aria-hidden
                className="hidden md:flex items-center justify-center mono tabular text-[20px] text-[var(--fg-3)] select-none"
              >
                {arrow}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Mini-visuals — friendly, marketing-friendly. Not engine diagnostics.
 * ---------------------------------------------------------------- */

interface VisualProps {
  reduced: boolean;
}

/** Step 01 — a chat-style prompt bubble. */
function AskVisual({ reduced }: VisualProps) {
  return (
    <div
      className="relative h-[72px] rounded-md border border-[var(--border)] bg-[var(--surface-2)] overflow-hidden px-3 py-2"
      aria-hidden
    >
      <div className="flex items-center gap-2 mono tabular text-[11px]">
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-[10px] leading-none"
          style={
            reduced
              ? undefined
              : {
                  animation:
                    'how-it-works-prompt-blink 2.6s ease-in-out infinite',
                }
          }
        >
          ›
        </span>
        <span className="text-[var(--fg-2)]">you</span>
        <span className="text-[var(--fg-3)]">·</span>
        <span className="text-[var(--fg)]">BTC 4h</span>
      </div>
      <div className="mt-2 flex items-center gap-2 mono tabular text-[10px] text-[var(--fg-3)]">
        <span className="inline-block h-1 w-1 rounded-full bg-[var(--accent)]" />
        <span>SOL 1d</span>
        <span>·</span>
        <span>ETH 15m</span>
        <span>·</span>
        <span>HYPE 1h</span>
      </div>
      <style>{`
        @keyframes how-it-works-prompt-blink {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/** Step 02 — a directional call-out card. */
function CallVisual({ reduced }: VisualProps) {
  return (
    <div
      className="relative h-[72px] rounded-md border border-[var(--border)] bg-[var(--surface-2)] overflow-hidden flex items-center justify-between px-4"
      aria-hidden
    >
      <div className="flex items-center gap-2">
        <span
          className="display font-bold text-[28px] leading-none text-[var(--accent)] tracking-tight"
          style={
            reduced
              ? undefined
              : {
                  animation: 'how-it-works-arrow 2.4s ease-in-out infinite',
                  transformOrigin: 'center',
                }
          }
        >
          ↑
        </span>
        <div className="flex flex-col">
          <span className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--fg-3)] leading-none">
            call
          </span>
          <span className="mono tabular text-[13px] font-semibold text-[var(--fg)] leading-tight">
            UP
          </span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="mono tabular text-[9px] uppercase tracking-[0.16em] text-[var(--fg-3)] leading-none">
          confidence
        </span>
        <AnimatedNumber
          value={78}
          format="pct"
          decimals={0}
          className="mono tabular text-[18px] font-bold text-[var(--fg)] leading-none"
        />
      </div>
      <style>{`
        @keyframes how-it-works-arrow {
          0%, 100% { transform: translateY(0); opacity: 0.9; }
          50% { transform: translateY(-2px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/** Step 03 — a tiny public-scoreboard tally. */
function ScoreboardVisual({ reduced }: VisualProps) {
  const cells: readonly { label: string; value: string; tone: 'mint' | 'gold' | 'fg-3' }[] = [
    { label: 'wins', value: '128', tone: 'mint' },
    { label: 'miss', value: '52', tone: 'gold' },
    { label: 'neut', value: '14', tone: 'fg-3' },
  ];
  return (
    <div
      className="relative h-[72px] rounded-md border border-[var(--border)] bg-[var(--surface-2)] overflow-hidden grid grid-cols-3"
      aria-hidden
    >
      {cells.map((cell, i) => {
        const color =
          cell.tone === 'mint'
            ? 'var(--accent)'
            : cell.tone === 'gold'
              ? 'var(--gold)'
              : 'var(--fg-3)';
        return (
          <div
            key={cell.label}
            className="flex flex-col items-center justify-center gap-1 border-r border-[var(--border)] last:border-r-0"
            style={
              reduced
                ? undefined
                : {
                    animation: `how-it-works-cell 2.6s ease-in-out ${i * 0.2}s infinite alternate`,
                  }
            }
          >
            <span
              className="mono tabular text-[9px] uppercase tracking-[0.16em] leading-none"
              style={{ color: 'var(--fg-3)' }}
            >
              {cell.label}
            </span>
            <span
              className="mono tabular text-[16px] font-bold leading-none"
              style={{ color }}
            >
              {cell.value}
            </span>
          </div>
        );
      })}
      <style>{`
        @keyframes how-it-works-cell {
          from { opacity: 0.85; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
