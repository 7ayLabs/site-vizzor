/**
 * ChainSelector — v0.2.0 ships Solana-native-only.
 *
 * Renders a single active option for SOL on Solana with the flat 10%
 * discount badge. Phase-2 chains (TON, USDC L2s, $VZR) are listed as
 * disabled "later cycle" placeholders so the marketing surface stays
 * intact while the underlying multi-chain plumbing is deferred.
 */

'use client';

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

const PHASE_2: ReadonlyArray<{ id: string; label: string; sub: string }> = [
  { id: 'ton', label: 'TON', sub: 'TON Connect · later cycle' },
  { id: 'usdc-base', label: 'USDC on Base', sub: 'Circle USDC · later cycle' },
  { id: 'usdc-arb', label: 'USDC on Arbitrum', sub: 'Circle USDC · later cycle' },
];

export function ChainSelector({
  value,
  onChange,
  tier,
  cadence,
}: ChainSelectorProps) {
  const t = useTranslations('pay.chain');
  const active = value.chain === 'solana' && value.token === 'native';
  const bps = discountBps(tier, cadence, 'solana', 'native');
  const pct = Math.round(bps / 100);

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
        <li>
          <button
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={0}
            onClick={() => onChange?.({ chain: 'solana', token: 'native' })}
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
                SOL on Solana
              </span>
              <span className="text-[11.5px] text-[var(--fg-2)]">
                Native SOL · sub-second finality · ~$0.0001 fees
              </span>
            </span>
            {pct > 0 ? (
              <span className="mono tabular text-[9.5px] uppercase tracking-[0.14em] bg-[var(--accent)] text-[var(--accent-fg)] px-2 py-0.5">
                {t('discountBadge', { pct })}
              </span>
            ) : null}
          </button>
        </li>
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
