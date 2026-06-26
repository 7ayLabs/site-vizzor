'use client';

/**
 * StatusPill — sidebar-footer subsystem indicator.
 *
 * Three states driven by `/api/health` (polled by `useHealth()`):
 *   - **green** (`healthy`)  — all reported subsystems ok
 *   - **amber** (`degraded`) — at least one subsystem stale/unavailable
 *                              OR engine probe down (informational only;
 *                              doesn't affect overall `.status`)
 *   - **red** (`down`)       — health endpoint itself unreachable
 *
 * Tooltip on hover lists the four subsystems with last-tick/latency
 * detail so an operator can triage without leaving the page.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useHealth, type SubsystemHealth } from '@/hooks/use-health';
import { paymentNetwork } from '@/lib/payment/network';

type PillTone = 'green' | 'amber' | 'red';

function toneFor(
  loading: boolean,
  error: unknown,
  data: ReturnType<typeof useHealth>['data'],
): PillTone {
  if (error && !data) return 'red';
  if (!data) return loading ? 'amber' : 'red';
  if (data.status === 'healthy' && data.subsystems.engine?.ok !== false) {
    return 'green';
  }
  return 'amber';
}

function relativeAge(timestamp?: number | null): string {
  if (!timestamp) return '—';
  const ageSec = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (ageSec < 60) return `${ageSec}s`;
  if (ageSec < 3600) return `${Math.round(ageSec / 60)}m`;
  return `${Math.round(ageSec / 3600)}h`;
}

function subsystemRow(
  label: string,
  s: SubsystemHealth | undefined,
): { label: string; ok: boolean; hint: string } {
  if (!s) return { label, ok: false, hint: 'unknown' };
  const parts: string[] = [];
  if (s.latencyMs != null) parts.push(`${s.latencyMs}ms`);
  if (s.lastTickAt != null) parts.push(`${relativeAge(s.lastTickAt)} ago`);
  if (s.detail) parts.push(s.detail);
  if (s.status != null) parts.push(`HTTP ${s.status}`);
  return { label, ok: s.ok, hint: parts.join(' · ') || (s.ok ? 'ok' : 'down') };
}

export function StatusPill() {
  const t = useTranslations('app.statusPill');
  const { data, error, isLoading } = useHealth();
  const [open, setOpen] = useState(false);
  const tone = toneFor(isLoading, error, data);
  const network = paymentNetwork();

  const dotColor =
    tone === 'green'
      ? 'bg-emerald-500'
      : tone === 'amber'
        ? 'bg-amber-500'
        : 'bg-rose-500';

  const label = data
    ? data.status === 'healthy' && data.subsystems.engine?.ok !== false
      ? t('healthy')
      : t('degraded')
    : isLoading
      ? t('loading')
      : t('down');

  const rows = data
    ? [
        subsystemRow(t('subsystem.engine'), data.subsystems.engine),
        subsystemRow(t('subsystem.rpc'), data.subsystems.watcher),
        subsystemRow(t('subsystem.sqlite'), data.subsystems.sqlite),
      ]
    : [];

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="
          w-full inline-flex items-center gap-2 rounded-md px-2.5 py-1.5
          text-[11px] text-[var(--fg-3)] hover:text-[var(--fg)]
          hover:bg-[var(--surface-2)] transition-colors
          focus-visible:outline-none focus-visible:ring-2
          focus-visible:ring-[var(--accent)]
        "
      >
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
        <span className="mono tabular flex-1 text-left">{label}</span>
        <span className="mono tabular text-[9.5px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
          {network}
        </span>
      </button>

      {open && data && (
        <div
          role="dialog"
          className="
            absolute bottom-full left-0 right-0 mb-2 z-30
            border border-[var(--border)] bg-[var(--surface)] shadow-lg
            rounded-lg p-3 flex flex-col gap-2
          "
        >
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[11px] text-[var(--fg-2)]">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${row.ok ? 'bg-emerald-500' : 'bg-amber-500'}`}
                />
                {row.label}
              </span>
              <span className="mono tabular text-[10px] text-[var(--fg-3)]">
                {row.hint}
              </span>
            </div>
          ))}
          {data.sha !== 'unknown' && (
            <div className="border-t border-[var(--border)] pt-2 mt-1 flex items-center justify-between text-[10px] text-[var(--fg-3)]">
              <span>{t('build')}</span>
              <span className="mono tabular">{data.sha.slice(0, 7)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
