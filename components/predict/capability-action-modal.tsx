'use client';

/**
 * CapabilityActionModal — the enable-step gateway.
 *
 * v0.5.0 UX evolved away from a full draft-form modal. Users draft
 * intents inline in the composer via the /transfer command syntax
 * (see lib/capabilities/command-syntax.ts); this modal now exists
 * ONLY for two edge cases the composer can't handle inline:
 *
 *   1. The wallet is free-tier and clicked a locked icon → show
 *      the "Upgrade to Pro" nudge.
 *   2. The capability isn't enabled yet in wallet_preferences →
 *      show the TOS body + Enable button. Accepting POSTs
 *      /api/capabilities/enabled with the current TOS version.
 *
 * On successful enable the modal auto-closes and the shell inserts
 * the command template into the composer (that's the affordance
 * the user reached for when they clicked). No more in-modal draft
 * form — the draft happens in the textbox as prompt syntax.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarClock, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCapabilities } from '@/lib/capabilities/use-capabilities';
import { type CapId } from '@/lib/capabilities/intent';

interface CapVisuals {
  Icon: typeof DollarSign;
  /** CSS variable providing the capability's accent hue. Matches the
   *  tray so the enable-modal and tray read as one visual language. */
  accentVar: string;
}
const CAP_VISUALS: Record<CapId, CapVisuals> = {
  transfer: { Icon: DollarSign, accentVar: '--cap-transfer' },
  payment: { Icon: CalendarClock, accentVar: '--cap-payment' },
};

interface Props {
  capability: CapId | null;
  /**
   * Passed down from the shell where it's derived from `/api/quota`
   * — the same source the sidebar tier badge uses.
   */
  tierLocked: boolean;
  onDismiss: () => void;
  /**
   * Fires after the enable POST returns 2xx. The shell then inserts
   * the command template into the composer so the user's very next
   * action is filling in the recipient — no second click needed.
   */
  onEnabled: (cap: CapId) => void;
}

export function CapabilityActionModal({
  capability,
  tierLocked,
  onDismiss,
  onEnabled,
}: Props) {
  const t = useTranslations('predict.capability');
  const cap = useCapabilities();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset error whenever the modal opens on a fresh capability.
  useEffect(() => {
    if (!capability) return;
    setError(null);
    setBusy(false);
  }, [capability]);

  const isEnabled = capability
    ? cap.enabledSet.has(capability)
    : false;
  const needsTos = !cap.isTosAccepted;

  // NOTE: We DELIBERATELY do not auto-fire onEnabled here when the
  // modal renders for an already-enabled capability. A previous
  // "safety" useEffect that did so double-inserted the command
  // template after a successful enable — because acceptEnable also
  // calls onEnabled right after cap.refresh(), and the SWR update
  // that flipped isEnabled would trip the safety effect too. The
  // shell routes enabled clicks straight to the template inserter
  // (see openCapabilityAction), so the modal never legitimately
  // opens for an enabled capability. If it somehow does, the early
  // return below dismisses it silently.

  const acceptEnable = useCallback(async () => {
    if (!capability) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/capabilities/enabled', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          capability,
          enabled: true,
          tos_version: cap.data.current_tos_version,
          tos_accepted_at: Date.now(),
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        reason?: string;
        detail?: string;
      };
      if (!res.ok || !data.ok) {
        setError(errorKeyWithDetail(data.reason, data.detail));
        return;
      }
      await cap.refresh();
      onEnabled(capability);
    } catch (e) {
      setError('errorNetwork');
      // eslint-disable-next-line no-console
      console.warn('[capability.enable] fetch failed', e);
    } finally {
      setBusy(false);
    }
  }, [capability, cap, onEnabled]);

  // Escape closes.
  useEffect(() => {
    if (!capability) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [capability, busy, onDismiss]);

  if (!capability) return null;
  // Already enabled → the useEffect above short-circuited; render
  // nothing while the shell takes over.
  if (isEnabled && !tierLocked) return null;

  const { Icon, accentVar } = CAP_VISUALS[capability];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        'fixed inset-0 z-[80] flex items-center justify-center p-4',
        'bg-[color-mix(in_oklab,var(--bg)_60%,transparent)]',
        'backdrop-blur-[3px]',
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onDismiss();
      }}
    >
      <div
        className={cn(
          'vz-intent-pop',
          // Tighter, calmer chrome: max-w-sm not md, moderate radius,
          // hairline border, no drop shadow. Aligns with the intent
          // card language downstream so the two surfaces feel like
          // one system.
          'w-full max-w-sm rounded-xl',
          'border border-[var(--border)]',
          'bg-[var(--surface)]',
        )}
      >
        {/* Header — inline capability-tinted glyph + title.
            No round icon box, no descriptive subtitle: the glyph +
            single-word title is enough affordance. */}
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center gap-2">
            <Icon
              size={13}
              strokeWidth={2}
              style={{ color: `var(${accentVar})` }}
              aria-hidden
            />
            <h2 className="text-[12.5px] font-semibold text-[var(--fg)] leading-none">
              {t(`tray.${capability}.label`)}
            </h2>
          </div>
        </div>

        {tierLocked ? (
          <TierLockedBody onClose={onDismiss} />
        ) : (
          <EnableBody
            needsTos={needsTos}
            busy={busy}
            onCancel={onDismiss}
            onAccept={() => void acceptEnable()}
            errorKey={error}
          />
        )}
      </div>
    </div>
  );
}

function TierLockedBody({ onClose }: { onClose: () => void }) {
  const t = useTranslations('predict.capability');
  const tIntent = useTranslations('predict.capability.intent');
  return (
    <div className="px-4 pt-1 pb-4">
      <p className="text-[11.5px] leading-relaxed text-[var(--fg-2)]">
        {t('tray.lockedTier')}
      </p>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className={buttonSecondaryCls}
        >
          {tIntent('close')}
        </button>
      </div>
    </div>
  );
}

function EnableBody({
  needsTos,
  busy,
  onCancel,
  onAccept,
  errorKey,
}: {
  needsTos: boolean;
  busy: boolean;
  onCancel: () => void;
  onAccept: () => void;
  errorKey: string | null;
}) {
  const t = useTranslations('predict.capability.settings');
  return (
    <div className="px-4 pt-1 pb-4">
      {/* Micro-label carries the legal signal ("this is an
          authorization moment") without stealing visual weight. */}
      <div className="mono tabular text-[9px] uppercase tracking-[0.22em] text-[var(--fg-3)] mb-1.5">
        {t('tosTitle')}
      </div>
      <p className="text-[11.5px] leading-relaxed text-[var(--fg-2)]">
        {t('tosBody')}
      </p>
      {errorKey && <ErrorBox errorKey={errorKey} />}
      <div className="mt-4 flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className={buttonSecondaryCls}
        >
          {t('tosCancel')}
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={busy}
          className={buttonPrimaryCls}
        >
          {needsTos ? t('tosAccept') : t('toggleLabel')}
        </button>
      </div>
    </div>
  );
}

/**
 * Fold the server's `reason` + optional `detail` into a single key
 * the modal can display. Detail carries the actual exception message
 * from the 500 path so we surface something meaningful instead of a
 * generic "something went wrong". Format: `<reason>::<detail>`.
 */
function errorKeyWithDetail(
  reason: string | undefined,
  detail: string | undefined,
): string {
  const base = reason && reason.length > 0 ? reason : 'errorGeneric';
  if (!detail) return base;
  return `${base}::${detail}`;
}

/**
 * Renders the split reason/detail pair. Prefers a translated
 * `reasons.<reason>` label when present; falls back to the raw
 * reason so an unmapped server error is still legible.
 */
function ErrorBox({ errorKey }: { errorKey: string }) {
  const t = useTranslations('predict.capability.intent');
  const [rawReason, detail] = errorKey.split('::');
  const reason = rawReason ?? errorKey;
  const CLIENT_LABELS: Record<string, string> = {
    errorNetwork: 'Network error. Try again.',
    errorGeneric: t('errorGeneric'),
  };
  const label = t.has(`reasons.${reason}` as never)
    ? t(`reasons.${reason}` as never)
    : (CLIENT_LABELS[reason] ?? reason);
  return (
    <div className="mt-3 rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--down)_10%,transparent)] px-3 py-2 text-[11.5px] text-[var(--down)]">
      <div>{label}</div>
      {detail && (
        <div className="mt-1 mono text-[10.5px] opacity-70 break-all">
          {detail}
        </div>
      )}
    </div>
  );
}

// Chrome matches the intent chat card (components/predict/intent-chat-card.tsx)
// so a user who arms → enables → signs sees three surfaces with the
// same button vocabulary.
const buttonPrimaryCls = cn(
  'inline-flex items-center justify-center rounded-md h-7 px-3',
  'text-[10.5px] font-semibold mono tabular uppercase tracking-[0.16em]',
  'bg-[var(--fg)] text-[var(--bg)]',
  'hover:opacity-90 active:scale-95',
  'disabled:opacity-40 disabled:cursor-not-allowed',
  'transition-[opacity,transform] duration-150',
);

const buttonSecondaryCls = cn(
  'inline-flex items-center justify-center h-7 px-2',
  'text-[10.5px] mono tabular uppercase tracking-[0.16em]',
  'text-[var(--fg-3)] hover:text-[var(--fg)]',
  'bg-transparent',
  'disabled:opacity-40 disabled:cursor-not-allowed',
  'transition-colors duration-150',
);
