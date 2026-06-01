/**
 * ChainSelector — Phase 1 = TON only (single row, highlighted).
 *
 * Pre-built for Phase 2 multi-chain expansion: the array of chains is
 * extracted into a const so adding more is just a config change. The
 * Phase 2 chains are rendered as a disabled preview ("Coming soon") so
 * the user can see the roadmap.
 */

'use client';

import { useTranslations } from 'next-intl';

interface ChainSelectorProps {
  value: 'ton';
  onChange?: (chain: 'ton') => void;
}

const PHASE_1: ReadonlyArray<{ id: 'ton'; label: string; sub: string }> = [
  { id: 'ton', label: 'TON', sub: 'TON native · TON Connect · instant confirm' },
];

const PHASE_2: ReadonlyArray<{ id: string; label: string; sub: string }> = [
  { id: 'polygon', label: 'Polygon', sub: 'USDC · 12-block finality' },
  { id: 'base', label: 'Base', sub: 'USDC · 12-block finality' },
  { id: 'arbitrum', label: 'Arbitrum', sub: 'USDC · 12-block finality' },
  { id: 'solana', label: 'Solana', sub: 'USDC · 32-slot finality' },
  { id: 'tron', label: 'TRON', sub: 'USDT · 20-block finality' },
];

export function ChainSelector({ value, onChange }: ChainSelectorProps) {
  const t = useTranslations('pay.chain');

  return (
    <div className="flex flex-col gap-3">
      <p className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
        {t('label')}
      </p>

      <ul className="flex flex-col gap-2">
        {PHASE_1.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onChange?.(c.id)}
              aria-pressed={value === c.id}
              className={`
                w-full flex items-center justify-between gap-3
                border px-3 py-3 text-left transition-colors
                ${
                  value === c.id
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
              <span className="mono tabular text-[9.5px] uppercase tracking-[0.14em] bg-[var(--accent)] text-[var(--accent-fg)] px-2 py-0.5">
                {t('phase1Label')}
              </span>
            </button>
          </li>
        ))}
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
