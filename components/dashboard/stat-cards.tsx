/**
 * StatCards — top row of the Vizzor dashboard.
 *
 * Four stat tiles in a horizontal grid: tracker WR · best horizon ·
 * worst horizon · last 24h. The shape mirrors the reference "wallet
 * balance / best performer / worst performer / suggested portfolio"
 * row, adapted to Vizzor's calibration story.
 *
 * Server component — reads from the committed snapshot.
 */

import { getTranslations } from 'next-intl/server';
import { getTrackerWR } from '@/lib/snapshot';

export async function StatCards() {
  const t = await getTranslations('predict.stats');
  const wr = getTrackerWR();
  const last24h = (wr as { last24h?: { hits: number; misses: number; neutrals: number; pending: number; decisiveWR: number } }).last24h;

  const horizonEntries = Object.entries(wr.byHorizon);
  const best = horizonEntries.reduce(
    (acc, [h, v]) => (v.wr > acc.wr ? { h, wr: v.wr, n: v.samples } : acc),
    { h: '—', wr: -Infinity, n: 0 },
  );
  const worst = horizonEntries.reduce(
    (acc, [h, v]) => (v.wr < acc.wr ? { h, wr: v.wr, n: v.samples } : acc),
    { h: '—', wr: Infinity, n: 0 },
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <Card
        label={t('trackerWr.label')}
        value={`${(wr.aggregate.wr * 100).toFixed(1)}%`}
        sub={t('trackerWr.sub', { n: wr.aggregate.samples })}
        tone="accent"
      />
      <Card
        label={t('bestHorizon.label')}
        value={`${(best.wr * 100).toFixed(1)}%`}
        sub={t('bestHorizon.sub', { horizon: best.h, n: best.n })}
        tone="up"
      />
      <Card
        label={t('worstHorizon.label')}
        value={`${(worst.wr * 100).toFixed(1)}%`}
        sub={t('worstHorizon.sub', { horizon: worst.h, n: worst.n })}
        tone="down"
      />
      <Card
        label={t('last24h.label')}
        value={last24h ? `${last24h.hits}/${last24h.hits + last24h.misses}` : '—'}
        sub={
          last24h
            ? t('last24h.sub', {
                pending: last24h.pending,
                wr: (last24h.decisiveWR * 100).toFixed(0),
              })
            : ''
        }
        tone={last24h && last24h.decisiveWR >= 0.5 ? 'up' : 'down'}
      />
    </div>
  );
}

function Card({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'accent' | 'up' | 'down';
}) {
  const toneColor =
    tone === 'accent'
      ? 'var(--accent)'
      : tone === 'up'
        ? 'var(--accent)'
        : 'var(--danger)';
  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col gap-2">
      <p className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
        {label}
      </p>
      <p
        className="display text-[28px] sm:text-[32px] leading-none font-semibold mono tabular"
        style={{ color: toneColor }}
      >
        {value}
      </p>
      <p className="mono tabular text-[10.5px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
        {sub}
      </p>
    </div>
  );
}
