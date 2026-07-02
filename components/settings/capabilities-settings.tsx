'use client';

/**
 * CapabilitiesSettings — /app/settings/capabilities client shell.
 *
 * Wires the four v0.5.0 capabilities to the wallet's preferences
 * store via /api/capabilities/enabled. Each capability has:
 *
 *   - Enable toggle (POSTs `{capability, enabled:true, tos_*}`);
 *     first-time enable opens the TOS modal to stamp acceptance.
 *   - Daily USD spend cap slider (0 → $10k, clamped server-side).
 *   - "Used today" readout so users see progress against their cap.
 *
 * At the bottom:
 *   - "Recent intents" history (last 20) drawn straight from the
 *     capability_audit ledger.
 *   - Kill-switch that atomically clears all enabled capabilities
 *     and expires any pending intents.
 *
 * All mutations are SIWS-gated and rate-limited server-side; this
 * component only manages the UI state + optimistic revalidation.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarClock, DollarSign } from 'lucide-react';
import { useCapabilities } from '@/lib/capabilities/use-capabilities';
import {
  ALL_CAP_IDS,
  DEFAULT_SPEND_CAPS_USD,
  shortAddress,
  type CapId,
} from '@/lib/capabilities/intent';
import { cn } from '@/lib/utils';

const CAP_ORDER: readonly CapId[] = ['transfer', 'payment'];

const CAP_ICONS: Record<CapId, typeof DollarSign> = {
  transfer: DollarSign,
  payment: CalendarClock,
};

export function CapabilitiesSettings() {
  const t = useTranslations('predict.capability');
  const cap = useCapabilities();
  const [pendingTos, setPendingTos] = useState<CapId | null>(null);
  const [busyCap, setBusyCap] = useState<CapId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = useCallback(
    async (payload: Record<string, unknown>): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch('/api/capabilities/enabled', {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as { ok: boolean; reason?: string };
        if (!res.ok || !data.ok) {
          setError(data.reason ?? 'internal_error');
          return false;
        }
        await cap.refresh();
        return true;
      } catch {
        setError('network');
        return false;
      }
    },
    [cap],
  );

  const onToggle = useCallback(
    async (capability: CapId, next: boolean) => {
      if (busyCap) return;
      if (next && !cap.isTosAccepted) {
        setPendingTos(capability);
        return;
      }
      setBusyCap(capability);
      await patch({
        capability,
        enabled: next,
        tos_version: cap.data.current_tos_version,
        tos_accepted_at:
          cap.data.tos_accepted_at ?? Date.now(),
      });
      setBusyCap(null);
    },
    [busyCap, cap, patch],
  );

  const onSpendCapChange = useCallback(
    async (capability: CapId, spendCapUsd: number) => {
      if (busyCap) return;
      setBusyCap(capability);
      await patch({
        capability,
        enabled: cap.enabledSet.has(capability),
        spend_cap_usd: spendCapUsd,
        tos_version: cap.data.current_tos_version,
        tos_accepted_at: cap.data.tos_accepted_at ?? Date.now(),
      });
      setBusyCap(null);
    },
    [busyCap, cap, patch],
  );

  const onKillSwitch = useCallback(async () => {
    if (busyCap) return;
    if (!window.confirm(t('settings.killSwitchConfirm'))) return;
    setBusyCap('transfer');
    await patch({ disable_all: true });
    setBusyCap(null);
  }, [busyCap, patch, t]);

  const onAcceptTos = useCallback(
    async (capability: CapId) => {
      setBusyCap(capability);
      const ok = await patch({
        capability,
        enabled: true,
        tos_version: cap.data.current_tos_version,
        tos_accepted_at: Date.now(),
      });
      setBusyCap(null);
      if (ok) setPendingTos(null);
    },
    [cap, patch],
  );

  return (
    <>
      <header className="mb-8">
        <h1 className="display text-[28px] sm:text-[32px] leading-tight tracking-tight font-semibold text-[var(--fg)]">
          {t('settings.title')}
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-[var(--fg-2)]">
          {t('settings.subtitle')}
        </p>
      </header>

      {cap.tierLocked && (
        <div className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[12px] text-[var(--fg-2)]">
          {t('tray.lockedTier')}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {CAP_ORDER.map((id) => (
          <CapabilityRow
            key={id}
            capId={id}
            enabled={cap.enabledSet.has(id)}
            spendCap={
              cap.data.spend_caps[id] ?? DEFAULT_SPEND_CAPS_USD[id]
            }
            spendUsed={cap.data.spend_used_today[id] ?? 0}
            disabled={cap.tierLocked || busyCap === id}
            busy={busyCap === id}
            onToggle={(next) => void onToggle(id, next)}
            onSpendCapChange={(v) => void onSpendCapChange(id, v)}
          />
        ))}
      </div>

      {/* Recent intents */}
      <section className="mt-10">
        <h2 className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--fg-3)] mb-3">
          {t('settings.history.title')}
        </h2>
        {cap.data.recent_intents.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-[12px] text-[var(--fg-3)] text-center">
            {t('settings.history.empty')}
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[var(--fg-3)] border-b border-[var(--border)]">
                  <th className="px-3 py-2 font-normal">
                    {t('settings.history.columns.kind')}
                  </th>
                  <th className="px-3 py-2 font-normal">
                    {t('settings.history.columns.symbol')}
                  </th>
                  <th className="px-3 py-2 font-normal">
                    {t('settings.history.columns.amount')}
                  </th>
                  <th className="px-3 py-2 font-normal">
                    {t('settings.history.columns.status')}
                  </th>
                  <th className="px-3 py-2 font-normal">
                    {t('settings.history.columns.time')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {cap.data.recent_intents.map((row) => (
                  <tr
                    key={row.intent_id}
                    className="border-b border-[var(--border)] last:border-b-0"
                  >
                    <td className="px-3 py-2 text-[var(--fg)]">
                      {t(`intent.kinds.${row.kind}` as never)}
                    </td>
                    <td className="px-3 py-2 mono">
                      {row.symbol ?? '—'}
                    </td>
                    <td className="px-3 py-2 mono tabular">
                      {row.amount ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill status={row.status} txHash={row.tx_hash} />
                    </td>
                    <td className="px-3 py-2 mono tabular text-[var(--fg-3)]">
                      {formatRelative(row.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Kill switch */}
      <section className="mt-10 rounded-2xl border border-[color-mix(in_oklab,var(--down)_20%,var(--border))] px-4 py-4">
        <button
          type="button"
          onClick={() => void onKillSwitch()}
          disabled={cap.tierLocked || cap.data.enabled.length === 0}
          className={cn(
            'text-[12px] font-semibold',
            'text-[var(--down)] hover:opacity-90',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {t('settings.killSwitch')}
        </button>
      </section>

      {error && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-[12px] text-[var(--down)] shadow-lg">
          {error}
        </div>
      )}

      {pendingTos && (
        <TosModal
          onCancel={() => setPendingTos(null)}
          onAccept={() => void onAcceptTos(pendingTos)}
          busy={busyCap === pendingTos}
        />
      )}
    </>
  );
}

function CapabilityRow({
  capId,
  enabled,
  spendCap,
  spendUsed,
  disabled,
  busy,
  onToggle,
  onSpendCapChange,
}: {
  capId: CapId;
  enabled: boolean;
  spendCap: number;
  spendUsed: number;
  disabled: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
  onSpendCapChange: (value: number) => void;
}) {
  const t = useTranslations('predict.capability');
  const Icon = CAP_ICONS[capId];
  const [localCap, setLocalCap] = useState<number>(spendCap);
  useMemo(() => setLocalCap(spendCap), [spendCap]);

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--fg)]">
            <Icon size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[var(--fg)]">
              {t(`tray.${capId}.label`)}
            </div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--fg-3)]">
              {t(`tray.${capId}.tooltip`)}
            </p>
          </div>
        </div>
        <label
          className={cn(
            'shrink-0 inline-flex items-center gap-2 cursor-pointer',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <span className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
            {t('settings.toggleLabel')}
          </span>
          <input
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
        </label>
      </div>
      {enabled && (
        <div className="mt-4 pt-4 border-t border-[var(--border)] flex items-center gap-4">
          <div className="flex-1">
            <div className="flex items-baseline justify-between mb-1">
              <span className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
                {t('settings.spendCapLabel')}
              </span>
              <span className="mono tabular text-[11px] text-[var(--fg)]">
                ${localCap.toFixed(0)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1000}
              step={10}
              value={localCap}
              disabled={disabled}
              onChange={(e) => setLocalCap(Number(e.target.value))}
              onMouseUp={() => onSpendCapChange(localCap)}
              onTouchEnd={() => onSpendCapChange(localCap)}
              className="w-full accent-[var(--accent)]"
            />
          </div>
          <div className="shrink-0 text-right">
            <div className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
              {t('settings.spendUsedLabel')}
            </div>
            <div className="mono tabular text-[12px] text-[var(--fg)]">
              ${spendUsed.toFixed(2)}
            </div>
          </div>
          {busy && (
            <div className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
              …
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TosModal({
  onCancel,
  onAccept,
  busy,
}: {
  onCancel: () => void;
  onAccept: () => void;
  busy: boolean;
}) {
  const t = useTranslations('predict.capability.settings');
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-[color-mix(in_oklab,var(--bg)_60%,transparent)] backdrop-blur-[3px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className={cn(
          'vz-intent-pop',
          'w-full max-w-md rounded-2xl border border-[var(--border)]',
          'bg-[color-mix(in_oklab,var(--surface)_92%,transparent)] backdrop-blur-[10px] shadow-2xl',
          'p-5',
        )}
      >
        <h2 className="text-[14px] font-semibold text-[var(--fg)]">
          {t('tosTitle')}
        </h2>
        <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--fg-2)]">
          {t('tosBody')}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-lg h-9 px-3 text-[12px] text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[color-mix(in_oklab,var(--fg)_6%,transparent)]"
          >
            {t('tosCancel')}
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-lg h-9 px-4 text-[12px] font-semibold bg-[var(--fg)] text-[var(--bg)] hover:opacity-90 disabled:opacity-40"
          >
            {t('tosAccept')}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusPill({
  status,
  txHash,
}: {
  status: string;
  txHash: string | null;
}) {
  const color =
    status === 'executed'
      ? 'var(--up)'
      : status === 'failed' || status === 'expired'
        ? 'var(--down)'
        : 'var(--fg-3)';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="mono text-[11px]" style={{ color }}>
        {status}
      </span>
      {status === 'executed' && txHash && (
        <span className="mono text-[10.5px] text-[var(--fg-3)]">
          {shortAddress(txHash, 4, 4)}
        </span>
      )}
    </span>
  );
}

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  const s = Math.max(1, Math.floor(diffMs / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
