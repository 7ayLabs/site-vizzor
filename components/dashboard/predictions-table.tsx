/**
 * PredictionsTable — recent predictions feed.
 *
 * Replaces the reference "Memes / All time" table at the bottom of the
 * dashboard. Each row is a Vizzor receipt — symbol, horizon, direction,
 * tier, confidence, outcome — pulled from the snapshot's
 * recentPredictions array.
 *
 * Server component — no client state.
 */

import { getTranslations } from 'next-intl/server';
import { getRecentPredictions } from '@/lib/snapshot';
import { formatUsd } from '@/lib/utils';
import type { Direction, Outcome, Tier } from '@/lib/types';

const TIER_EMOJI: Record<Tier, string> = {
  'high-conviction': '🌟',
  'whale-confirmed': '🐋',
  tracked: '✅',
  advisory: '⚪',
};

const DIR_GLYPH: Record<Direction, { arrow: string; tone: string }> = {
  up: { arrow: '↑', tone: 'var(--accent)' },
  down: { arrow: '↓', tone: 'var(--danger)' },
  sideways: { arrow: '↔', tone: 'var(--fg-3)' },
};

const OUTCOME_TONE: Record<Outcome, string> = {
  hit: 'var(--accent)',
  miss: 'var(--danger)',
  neutral: 'var(--fg-3)',
  pending: 'var(--fg-3)',
};

export async function PredictionsTable() {
  const t = await getTranslations('predict.table');
  const tt = await getTranslations('predict.tiers');
  const predictions = getRecentPredictions({ limit: 10 });

  return (
    <div className="border border-[var(--border)] bg-[var(--surface)]">
      <header className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-3">
        <p className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
          {t('label')}
        </p>
        <p className="mono tabular text-[10px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
          {t('count', { n: predictions.length })}
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[12.5px]">
          <thead>
            <tr className="text-left mono tabular text-[10px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
              <Th>{t('cols.symbol')}</Th>
              <Th>{t('cols.horizon')}</Th>
              <Th>{t('cols.direction')}</Th>
              <Th>{t('cols.confidence')}</Th>
              <Th>{t('cols.tier')}</Th>
              <Th>{t('cols.entry')}</Th>
              <Th>{t('cols.outcome')}</Th>
            </tr>
          </thead>
          <tbody>
            {predictions.map((p) => {
              const dir = DIR_GLYPH[p.direction];
              const outcome = p.outcome ?? 'pending';
              return (
                <tr
                  key={p.id}
                  className="border-t border-[var(--border)] hover:bg-[var(--surface-2)]/30"
                >
                  <Td>
                    <span className="mono tabular font-medium text-[var(--fg)]">
                      {p.symbol}
                    </span>
                  </Td>
                  <Td>
                    <span className="mono tabular text-[var(--fg-2)]">
                      {p.horizon}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className="mono tabular text-[12px]"
                      style={{ color: dir.tone }}
                    >
                      {dir.arrow} {p.direction}
                    </span>
                  </Td>
                  <Td>
                    <ConfBar value={p.confidence} />
                  </Td>
                  <Td>
                    <span className="mono tabular text-[11px] text-[var(--fg-2)]">
                      {TIER_EMOJI[p.tier]} {tt(p.tier)}
                    </span>
                  </Td>
                  <Td>
                    <span className="mono tabular text-[var(--fg-2)]">
                      {formatUsd(p.entryPrice)}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className="mono tabular text-[10px] uppercase tracking-[0.14em]"
                      style={{ color: OUTCOME_TONE[outcome] }}
                    >
                      {outcome}
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2 font-medium">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3">{children}</td>;
}

function ConfBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  const color =
    pct >= 0.7
      ? 'var(--accent)'
      : pct >= 0.55
        ? 'var(--gold)'
        : 'var(--fg-3)';
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="h-1.5 flex-1 bg-[var(--surface-2)] overflow-hidden">
        <div
          className="h-full"
          style={{ width: `${pct * 100}%`, background: color }}
        />
      </div>
      <span className="mono tabular text-[11px] text-[var(--fg-3)] w-9 text-right">
        {(pct * 100).toFixed(0)}%
      </span>
    </div>
  );
}
