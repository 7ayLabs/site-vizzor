'use client';

/**
 * HowItWorksClient — three Heylink-style cards: eyebrow chip → step
 * number + title + one-line description → mock product UI on the bottom.
 *
 * Each mock UI is intentionally still (no live data binding): the live
 * surface lives on the hero. The job here is to show *what the surfaces
 * look like* in the three setup moments so a first-time visitor reads
 * the product shape in three glances.
 *
 *   01 Connect — SIWS button + wallet identicon
 *   02 Predict — chat composer placeholder + faint confidence chip
 *   03 Resolve — Telegram-style notification "prediction resolved"
 *
 * Visual: rounded-2xl, hairline border (--border), subtle padding,
 * strict monochrome. NO chromatic accents on chrome — direction tokens
 * (--up / --down) only on explicit hit/miss glyphs for colorblind
 * carry-through.
 *
 * Reveal: GSAP stagger via the shared `runGsapReveal` primitive.
 * Reduced motion snaps each card to its final state instantly.
 */

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { useReducedMotionSafe } from '@/lib/motion';
import { CoinIcon } from '@/components/ui/coin-icon';
import { cn } from '@/lib/utils';

export interface HowItWorksStep {
  key: 'connect' | 'predict' | 'resolve';
  number: string;
  eyebrow: string;
  title: string;
  description: string;
}

export interface HowItWorksClientProps {
  steps: readonly [HowItWorksStep, HowItWorksStep, HowItWorksStep];
}

export function HowItWorksClient({ steps }: HowItWorksClientProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<HTMLDivElement[]>([]);
  const reduced = useReducedMotionSafe();

  // Scroll-triggered stagger reveal — single-shot IntersectionObserver,
  // fires when the card grid first enters the viewport. The bespoke
  // timeline (vs. the canonical `runGsapReveal`) layers a slight
  // overshoot ease + scale settle so the three cards feel like they're
  // dropping into a grid, not fading in flat. Reduced-motion users snap
  // to the final state.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const targets = cardRefs.current.filter(
      (el): el is HTMLDivElement => el !== null,
    );
    if (targets.length === 0) return;

    if (reduced) {
      gsap.set(targets, { opacity: 1, y: 0, scale: 1 });
      return;
    }

    gsap.set(targets, { opacity: 0, y: 24, scale: 0.985 });

    let played = false;
    let tween: gsap.core.Tween | null = null;
    const play = (): void => {
      if (played) return;
      played = true;
      tween = gsap.to(targets, {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.72,
        ease: 'back.out(1.25)',
        stagger: 0.12,
      });
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            play();
            io.unobserve(entry.target);
            break;
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    io.observe(root);

    return () => {
      io.disconnect();
      if (tween) tween.kill();
    };
  }, [reduced]);

  const setCardRef = (idx: number) => (el: HTMLDivElement | null): void => {
    if (el) cardRefs.current[idx] = el;
  };

  const visualByKey: Record<HowItWorksStep['key'], React.ReactNode> = {
    connect: <ConnectVisual />,
    predict: <PredictVisual />,
    resolve: <ResolveVisual />,
  };

  return (
    <div
      ref={rootRef}
      className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6 items-stretch"
    >
      {steps.map((step, idx) => (
        <article
          key={step.key}
          ref={setCardRef(idx)}
          className={cn(
            'group relative flex flex-col',
            'rounded-2xl bg-[var(--surface)] border border-[var(--border)]',
            // Stacked shadows: a hairline inset highlight at the top
            // (reads like light catching the upper edge of a card lifted
            // off the page) + the existing drop shadow underneath. The
            // inset uses color-mix against --fg so it stays correct
            // across light and dark modes without per-theme overrides.
            'shadow-[inset_0_1px_0_0_color-mix(in_oklab,var(--fg)_4%,transparent),0_8px_32px_-16px_rgba(0,0,0,0.18)]',
            'dark:shadow-[inset_0_1px_0_0_color-mix(in_oklab,var(--fg)_6%,transparent),0_8px_32px_-10px_rgba(0,0,0,0.55)]',
            'transition-[transform,box-shadow,border-color] duration-300 ease-out',
            'hover:border-[var(--border-hi)]',
            'hover:shadow-[inset_0_1px_0_0_color-mix(in_oklab,var(--fg)_6%,transparent),0_16px_40px_-16px_rgba(0,0,0,0.28)]',
            'dark:hover:shadow-[inset_0_1px_0_0_color-mix(in_oklab,var(--fg)_8%,transparent),0_16px_40px_-12px_rgba(0,0,0,0.65)]',
            'motion-safe:hover:[transform:translateY(-2px)]',
            'overflow-hidden',
          )}
        >
          {/* ── Header: eyebrow chip + step number ─────────────────── */}
          <header className="flex items-center justify-between px-6 pt-6">
            <span
              className="
                mono tabular inline-flex items-center rounded-full
                border border-[var(--border)] bg-[var(--surface-2)]
                px-2.5 py-0.5
                text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-2)]
              "
            >
              {step.eyebrow}
            </span>
            <span className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
              STEP {step.number}
            </span>
          </header>

          {/* ── Title + description ────────────────────────────────── */}
          <div className="px-6 pt-4 flex flex-col gap-2">
            <h3 className="display text-[20px] sm:text-[22px] leading-[1.1] tracking-[-0.02em] font-semibold text-[var(--fg)]">
              {step.title}
            </h3>
            <p className="text-[13.5px] leading-relaxed text-[var(--fg-2)] max-w-[42ch]">
              {step.description}
            </p>
          </div>

          {/* ── Mock UI ────────────────────────────────────────────── */}
          <div className="px-5 pb-6 pt-6 mt-auto">{visualByKey[step.key]}</div>
        </article>
      ))}
    </div>
  );
}

/* ─────────────────────────── shared visual frame ─────────────────────────── */

function MockFrame({
  children,
  className,
  ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  ariaLabel: string;
}) {
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={cn(
        'relative rounded-xl border border-[var(--border)] bg-[var(--bg)]',
        'overflow-hidden',
        className,
      )}
    >
      <div className="relative p-4">{children}</div>
    </div>
  );
}

/* ─────────────────────────── 01 · Connect wallet ─────────────────────────── */

function ConnectVisual() {
  return (
    <MockFrame
      className="min-h-[176px]"
      ariaLabel="Mock UI: Sign in with Solana button next to a wallet identicon"
    >
      <div className="flex flex-col gap-4">
        {/* Wallet identicon row */}
        <div className="flex items-center gap-3">
          <WalletIdenticon />
          <div className="flex flex-col min-w-0">
            <span className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)] leading-none">
              wallet
            </span>
            <span className="mono tabular text-[12px] text-[var(--fg)] mt-1 leading-tight truncate">
              7xKp…fA2c
            </span>
          </div>
          <span
            className="
              ml-auto mono tabular text-[9.5px] uppercase tracking-[0.16em]
              text-[var(--fg-3)] inline-flex items-center gap-1
            "
          >
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-[var(--fg-3)]"
            />
            Solana
          </span>
        </div>

        {/* SIWS primary button */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className="
            inline-flex items-center justify-center gap-2 w-full
            h-10 rounded-full bg-[var(--fg)] text-[var(--bg)]
            text-[12.5px] font-semibold tracking-tight
            pointer-events-none
          "
        >
          <span>Sign in with Solana</span>
        </button>

        {/* Helper text */}
        <p className="mono tabular text-[10.5px] uppercase tracking-[0.14em] text-[var(--fg-3)] text-center">
          One signature · no email
        </p>
      </div>
    </MockFrame>
  );
}

function WalletIdenticon() {
  // Static deterministic 4x4 mosaic — purely decorative chrome, the
  // wallet identicon visual that Phantom et al. use. Kept inline so the
  // mock doesn't pull a runtime hash library into the marketing bundle.
  const cells: ReadonlyArray<0 | 1> = [
    1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0,
  ];
  return (
    <span
      aria-hidden
      className="
        relative inline-grid grid-cols-4 grid-rows-4 gap-[2px]
        h-9 w-9 rounded-md border border-[var(--border)] bg-[var(--surface-2)]
        p-1
      "
    >
      {cells.map((on, idx) => (
        <span
          key={idx}
          className={cn(
            'rounded-[1px]',
            on ? 'bg-[var(--fg)]' : 'bg-transparent',
          )}
        />
      ))}
    </span>
  );
}

/* ─────────────────────────── 02 · Predict ─────────────────────────── */

function PredictVisual() {
  return (
    <MockFrame
      className="min-h-[176px]"
      ariaLabel="Mock UI: chat composer asking 'Will BTC close above $X by Friday?' with a faint confidence chip"
    >
      <div className="flex flex-col gap-4">
        {/* Recent symbol chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="mono tabular text-[9px] uppercase tracking-[0.16em] text-[var(--fg-3)] mr-1">
            recent
          </span>
          {(['BTC', 'ETH', 'SOL'] as const).map((sym) => (
            <span
              key={sym}
              className="
                inline-flex items-center gap-1 rounded-full
                border border-[var(--border)] px-2 py-0.5
                mono tabular text-[10px] text-[var(--fg-2)]
              "
            >
              <CoinIcon symbol={sym} size={11} />
              {sym}
            </span>
          ))}
        </div>

        {/* Composer input */}
        <div
          className="
            flex items-center gap-2 rounded-full
            border border-[var(--border)] bg-[var(--surface)]
            pl-3 pr-1 py-1
          "
        >
          <span
            aria-hidden
            className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--fg)] motion-safe:animate-pulse shrink-0"
          />
          <span className="mono tabular text-[11px] text-[var(--fg-3)] flex-1 truncate">
            Will BTC close above $X by Friday?
          </span>
          <span
            className="
              inline-flex items-center justify-center h-6 px-2.5
              rounded-full bg-[var(--fg)] text-[var(--bg)]
              text-[10px] font-semibold tracking-tight
            "
          >
            ASK →
          </span>
        </div>

        {/* Confidence chip — faint, anticipating the response */}
        <div className="flex items-center justify-between">
          <span className="mono tabular text-[9.5px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
            calibrated
          </span>
          <span
            className="
              inline-flex items-center gap-1.5 rounded-full
              border border-dashed border-[var(--border)] px-2.5 py-0.5
              mono tabular text-[10px] text-[var(--fg-3)]
            "
          >
            <span aria-hidden>~</span>
            <span>confidence</span>
          </span>
        </div>
      </div>
    </MockFrame>
  );
}

/* ─────────────────────────── 03 · Resolve ─────────────────────────── */

function ResolveVisual() {
  return (
    <MockFrame
      className="min-h-[176px]"
      ariaLabel="Mock UI: Telegram-style notification — 'Vizzor: prediction resolved — HIT (74% conf)'"
    >
      <div className="flex flex-col gap-3">
        {/* Notification header — Telegram-style */}
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="
              inline-flex h-7 w-7 items-center justify-center
              rounded-full border border-[var(--border)] bg-[var(--surface-2)]
              mono tabular text-[10px] font-bold text-[var(--fg)]
            "
          >
            V
          </span>
          <span className="mono tabular text-[12px] font-semibold text-[var(--fg)] leading-none">
            Vizzor
          </span>
          <span className="mono tabular text-[10px] text-[var(--fg-3)] ml-auto">
            now
          </span>
        </div>

        {/* Notification body */}
        <div
          className="
            rounded-xl border border-[var(--border)] bg-[var(--surface)]
            px-3 py-2.5 flex flex-col gap-1.5
          "
        >
          <span className="text-[12.5px] text-[var(--fg)] leading-snug">
            Prediction resolved
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="
                mono tabular inline-flex items-center gap-1 rounded-full
                border border-[var(--border-hi)] px-2 py-0.5
                text-[9.5px] font-semibold uppercase tracking-[0.16em]
              "
              style={{ color: 'var(--up)' }}
            >
              <span aria-hidden>✓</span>
              <span>HIT</span>
            </span>
            <span className="mono tabular text-[10.5px] text-[var(--fg-2)]">
              74% conf · BTC · 1d
            </span>
          </div>
        </div>

        {/* Footer hint */}
        <p className="mono tabular text-[10px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
          Receipt logged to the public scoreboard
        </p>
      </div>
    </MockFrame>
  );
}
