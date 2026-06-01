/**
 * TierDonut — SVG donut showing tier composition.
 *
 * Replaces the reference "Top Constituents" panel. Slices use the
 * project's tier color tokens (gold, whale, accent, fg-3) so the
 * legend mirrors the visual language used in PredictionCard etc.
 *
 * Server component — pure read from snapshot.
 */

import { getTranslations } from 'next-intl/server';
import { getTrackerWR } from '@/lib/snapshot';

const TIERS = [
  { key: 'high-conviction', color: 'var(--gold)', emoji: '🌟' },
  { key: 'whale-confirmed', color: 'var(--whale)', emoji: '🐋' },
  { key: 'tracked', color: 'var(--accent)', emoji: '✅' },
  { key: 'advisory', color: 'var(--fg-3)', emoji: '⚪' },
] as const;

export async function TierDonut() {
  const t = await getTranslations('predict.donut');
  const tt = await getTranslations('predict.tiers');
  const wr = getTrackerWR();

  const total = TIERS.reduce((s, x) => s + wr.byTier[x.key].samples, 0);
  let cursor = 0;
  const slices = TIERS.map((x) => {
    const samples = wr.byTier[x.key].samples;
    const start = cursor;
    const sweep = total > 0 ? (samples / total) * 360 : 0;
    cursor += sweep;
    return { ...x, samples, pct: total > 0 ? samples / total : 0, start, sweep };
  });

  const cx = 80;
  const cy = 80;
  const radius = 60;
  const stroke = 14;

  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] p-5 flex flex-col gap-4 h-full">
      <p className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
        {t('label')}
      </p>

      <div className="flex items-center gap-6">
        {/* Donut */}
        <svg
          width="160"
          height="160"
          viewBox="0 0 160 160"
          aria-label={t('label')}
          role="img"
          className="flex-none"
        >
          {/* Background ring */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="var(--surface-2)"
            strokeWidth={stroke}
          />
          {slices.map((s) =>
            s.sweep > 0 ? (
              <path
                key={s.key}
                d={arcPath(cx, cy, radius, s.start, s.start + s.sweep)}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeLinecap="butt"
              />
            ) : null,
          )}
          {/* Center label */}
          <text
            x={cx}
            y={cy - 4}
            textAnchor="middle"
            className="font-semibold"
            style={{ fontSize: 26, fill: 'var(--fg)' }}
          >
            {total}
          </text>
          <text
            x={cx}
            y={cy + 16}
            textAnchor="middle"
            style={{
              fontSize: 8,
              letterSpacing: 1.6,
              textTransform: 'uppercase',
              fill: 'var(--fg-3)',
            }}
          >
            {t('center')}
          </text>
        </svg>

        {/* Legend */}
        <ul className="flex-1 space-y-2 min-w-0">
          {slices.map((s) => (
            <li
              key={s.key}
              className="flex items-center justify-between gap-2 text-[12px]"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  aria-hidden
                  className="h-2 w-2 flex-none"
                  style={{ background: s.color }}
                />
                <span className="truncate text-[var(--fg-2)]">
                  {s.emoji} {tt(s.key)}
                </span>
              </span>
              <span className="mono tabular text-[var(--fg-3)] text-[11px]">
                {(s.pct * 100).toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Build an SVG arc path for the donut slice between two angles
 * (in degrees, clockwise, 0° = 12 o'clock).
 */
function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  const start = polar(cx, cy, r, endDeg);
  const end = polar(cx, cy, r, startDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}
