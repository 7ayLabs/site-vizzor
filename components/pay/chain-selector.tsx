/**
 * ChainSelector — Phase 1 has TWO chains: TON native, Solana-$VIZZOR.
 *
 * Phase 1 #1: TON native (base rate)
 * Phase 1 #2: Solana-$VIZZOR with 25/30/35% discount per cadence
 * Phase 2: USDC on Polygon/Base/Arbitrum/Solana + USDT on TRON
 *
 * The discount badge is derived from the active tier+cadence via
 * `discountBps()` so the selector renders the right "Save N%" pill.
 *
 * Accessibility: the list is rendered as a `role="radiogroup"` with
 * each option as a `role="radio"`. Tab moves focus into the group;
 * arrow keys move between the active options; Space/Enter selects.
 * Disabled Phase-2 options are excluded from the keyboard tab order.
 */

'use client';

import { useRef, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import type {
  PaymentCadence,
  PaymentChain,
  PaymentTier,
  PaymentToken,
} from '@/lib/payment/session';
import { discountBps } from '@/lib/payment/pricing-table';

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

interface Phase1Option {
  id: string;
  chain: PaymentChain;
  token: PaymentToken;
  label: string;
  sub: string;
}

const PHASE_1: ReadonlyArray<Phase1Option> = [
  {
    id: 'ton:native',
    chain: 'ton',
    token: 'native',
    label: 'TON',
    sub: 'TON native · TON Connect · instant confirm',
  },
  {
    id: 'solana:vizzor',
    chain: 'solana',
    token: 'vizzor',
    label: '$VIZZOR on Solana',
    sub: 'Pay with the project token · sub-second finality',
  },
];

const PHASE_2: ReadonlyArray<{ id: string; label: string; sub: string }> = [
  { id: 'polygon', label: 'Polygon', sub: 'USDC · 12-block finality' },
  { id: 'base', label: 'Base', sub: 'USDC · 12-block finality' },
  { id: 'arbitrum', label: 'Arbitrum', sub: 'USDC · 12-block finality' },
  { id: 'solana-usdc', label: 'Solana', sub: 'USDC · 32-slot finality' },
  { id: 'tron', label: 'TRON', sub: 'USDT · 20-block finality' },
];

export function ChainSelector({
  value,
  onChange,
  tier,
  cadence,
}: ChainSelectorProps) {
  const t = useTranslations('pay.chain');
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeIndex = PHASE_1.findIndex(
    (c) => value.chain === c.chain && value.token === c.token,
  );

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number): void => {
    let nextIdx = idx;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      nextIdx = (idx + 1) % PHASE_1.length;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      nextIdx = (idx - 1 + PHASE_1.length) % PHASE_1.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = PHASE_1.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    const nextOption = PHASE_1[nextIdx];
    if (nextOption) {
      onChange?.({ chain: nextOption.chain, token: nextOption.token });
      optionRefs.current[nextIdx]?.focus();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p
        id="pay-chain-label"
        className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)]"
      >
        {t('label')}
      </p>

      <ul
        role="radiogroup"
        aria-labelledby="pay-chain-label"
        className="flex flex-col gap-2"
      >
        {PHASE_1.map((c, idx) => {
          const active = value.chain === c.chain && value.token === c.token;
          const bps = discountBps(tier, cadence, c.chain, c.token);
          const pct = Math.round(bps / 100);
          // Roving tab index: only the active option (or the first if
          // none active) is in the tab order; the rest are reachable
          // via arrow keys.
          const tabIndex =
            activeIndex === -1 ? (idx === 0 ? 0 : -1) : active ? 0 : -1;
          return (
            <li key={c.id}>
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
                  w-full flex items-center justify-between gap-3
                  border px-3 py-3 text-left transition-colors
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]
                  ${
                    active
                      ? 'border-[var(--accent)] bg-[var(--surface)] shadow-[0_0_0_1px_var(--accent)]'
                      : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)]'
                  }
                `}
              >
                <span className="flex flex-col">
                  <span className="text-[13px] font-semibold text-[var(--fg)]">
                    {c.label}
                  </span>
                  <span className="text-[11.5px] text-[var(--fg-2)]">
                    {c.sub}
                  </span>
                </span>
                {pct > 0 ? (
                  <span className="mono tabular text-[9.5px] uppercase tracking-[0.14em] bg-[var(--accent)] text-[var(--accent-fg)] px-2 py-0.5">
                    {t('discountBadge', { pct })}
                  </span>
                ) : (
                  <span className="mono tabular text-[9.5px] uppercase tracking-[0.14em] border border-[var(--border)] text-[var(--fg-3)] px-2 py-0.5">
                    {t('phase1Label')}
                  </span>
                )}
              </button>
            </li>
          );
        })}
        {PHASE_2.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              disabled
              className="
                w-full flex items-center justify-between gap-3
                border border-[var(--border)] bg-transparent
                px-3 py-3 text-left opacity-50 cursor-not-allowed
              "
            >
              <span className="flex flex-col">
                <span className="text-[13px] font-semibold text-[var(--fg-2)]">
                  {c.label}
                </span>
                <span className="text-[11.5px] text-[var(--fg-3)]">
                  {c.sub}
                </span>
              </span>
              <span className="mono tabular text-[9.5px] uppercase tracking-[0.14em] border border-[var(--border)] text-[var(--fg-3)] px-2 py-0.5">
                {t('phase2Label')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
