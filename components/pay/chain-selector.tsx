'use client';

/**
 * ChainSelector — animated multi-chain payment picker.
 *
 * Four live rails: SOL on Solana, TON on TON, USDC on Base, USDC on
 * Arbitrum. Each surfaces a per-chain discount badge driven by
 * `discountBps()` so the selector reflects the live pricing matrix.
 *
 * UX details:
 *   - Real official mark for each chain (components/pay/chain-icons).
 *   - GSAP stagger on first mount: each option slides up + fades in.
 *   - Hover micro-lift + accent ring on the active option.
 *   - Smooth transition on the active indicator (CSS, not JS — keeps
 *     the keyboard arrow-key path responsive).
 *
 * Accessibility: rendered as `role="radiogroup"` with each option as
 * a `role="radio"`. Tab moves into the group; arrow keys move between
 * options; Space/Enter selects.
 */

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { gsap } from 'gsap';
import { Check } from 'lucide-react';
import type {
  PaymentCadence,
  PaymentChain,
  PaymentTier,
  PaymentToken,
} from '@/lib/payment/session';
import { discountBps } from '@/lib/payment/pricing-table';
import type { ChainIconId } from './chain-icons';
import { ChainOptionIcon } from './chain-option-icon';
import { isNonProd, networkBadgeLabel } from '@/lib/payment/network';

export interface SelectorValue {
  chain: PaymentChain;
  token: PaymentToken;
}

interface ChainSelectorProps {
  value: SelectorValue;
  onChange?: (next: SelectorValue) => void;
  tier: PaymentTier;
  cadence: PaymentCadence;
}

interface ChainOption {
  id: string;
  chain: PaymentChain;
  token: PaymentToken;
  /** Primary mark rendered at full size. */
  primaryIcon: ChainIconId;
  /** Optional small badge to overlay (e.g. USDC over Base/Arbitrum). */
  networkBadge?: ChainIconId;
  label: string;
}

/**
 * Options ordered by discount descending. The pricing matrix is the
 * source of truth — if discounts change, re-sort here.
 */
const OPTIONS: ReadonlyArray<ChainOption> = [
  {
    id: 'solana:native',
    chain: 'solana',
    token: 'native',
    primaryIcon: 'solana',
    label: 'SOL · Solana',
  },
  {
    id: 'ton:native',
    chain: 'ton',
    token: 'native',
    primaryIcon: 'ton',
    label: 'TON',
  },
  {
    id: 'base:usdc',
    chain: 'base',
    token: 'usdc',
    primaryIcon: 'usdc',
    networkBadge: 'base',
    label: 'USDC · Base',
  },
  {
    id: 'arbitrum:usdc',
    chain: 'arbitrum',
    token: 'usdc',
    primaryIcon: 'usdc',
    networkBadge: 'arbitrum',
    label: 'USDC · Arbitrum',
  },
];

export function ChainSelector({
  value,
  onChange,
  tier,
  cadence,
}: ChainSelectorProps) {
  const t = useTranslations('pay.chain');
  const listRef = useRef<HTMLUListElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // GSAP entrance: stagger each option up + fade in on first mount.
  // Respects prefers-reduced-motion via the early return — GSAP doesn't
  // honor the media query natively, so we gate it ourselves.
  useEffect(() => {
    if (!listRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const items = listRef.current.querySelectorAll<HTMLLIElement>('[data-anim]');
    gsap.fromTo(
      items,
      { opacity: 0, y: 10 },
      {
        opacity: 1,
        y: 0,
        duration: 0.35,
        ease: 'power2.out',
        stagger: 0.06,
      },
    );
  }, []);

  const activeIndex = OPTIONS.findIndex(
    (c) => value.chain === c.chain && value.token === c.token,
  );

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number): void => {
    let nextIdx = idx;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      nextIdx = (idx + 1) % OPTIONS.length;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      nextIdx = (idx - 1 + OPTIONS.length) % OPTIONS.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = OPTIONS.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    const nextOption = OPTIONS[nextIdx];
    if (nextOption) {
      onChange?.({ chain: nextOption.chain, token: nextOption.token });
      optionRefs.current[nextIdx]?.focus();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p
        id="pay-chain-label"
        className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-3)] inline-flex items-center gap-2"
      >
        <span>{t('label')}</span>
        {isNonProd() && (
          <span
            className="
              rounded-md px-1.5 py-0.5
              mono tabular text-[9.5px] uppercase tracking-[0.18em]
              border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-2)]
            "
          >
            {networkBadgeLabel()}
          </span>
        )}
      </p>

      <ul
        ref={listRef}
        role="radiogroup"
        aria-labelledby="pay-chain-label"
        className="flex flex-col gap-2"
      >
        {OPTIONS.map((c, idx) => {
          const active = value.chain === c.chain && value.token === c.token;
          const bps = discountBps(tier, cadence, c.chain, c.token);
          const pct = Math.round(bps / 100);
          const tabIndex =
            activeIndex === -1 ? (idx === 0 ? 0 : -1) : active ? 0 : -1;
          return (
            <li key={c.id} data-anim>
              <button
                ref={(el) => {
                  optionRefs.current[idx] = el;
                }}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={tabIndex}
                onClick={() =>
                  onChange?.({ chain: c.chain, token: c.token })
                }
                onKeyDown={(e) => onKeyDown(e, idx)}
                className={`
                  group w-full flex items-center gap-3
                  px-4 py-3 rounded-xl
                  border transition-colors
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]
                  ${
                    active
                      ? 'border-[var(--fg)] bg-[var(--surface-2)]'
                      : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)]'
                  }
                `}
              >
                <ChainOptionIcon
                  primary={c.primaryIcon}
                  networkBadge={c.networkBadge}
                  active={active}
                  size={36}
                />

                <span className="flex-1 min-w-0 text-[14px] font-medium text-[var(--fg)] truncate">
                  {c.label}
                </span>

                {pct > 0 && (
                  <span
                    className={`
                      mono tabular text-[10px] uppercase tracking-[0.16em]
                      px-2 py-0.5 rounded-md shrink-0
                      ${
                        active
                          ? 'bg-[var(--fg)] text-[var(--bg)]'
                          : 'border border-[var(--border)] text-[var(--fg-2)]'
                      }
                    `}
                  >
                    −{pct}%
                  </span>
                )}

                <span
                  aria-hidden
                  className={`
                    mono tabular text-[11px] uppercase tracking-[0.16em] shrink-0 transition-colors
                    ${active ? 'text-[var(--fg)]' : 'text-[var(--fg-3)] group-hover:text-[var(--fg)]'}
                  `}
                >
                  {active ? <Check size={15} strokeWidth={2.4} /> : '→'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
