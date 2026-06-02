'use client';

/**
 * PaymentStatus — visible state of the payment lifecycle.
 *
 * States:
 *   idle              — user hasn't started the payment yet
 *   creating          — POST /api/payment/session in flight
 *   awaiting_wallet   — session created, waiting for wallet sign
 *   broadcasting      — wallet returned the tx, broadcasting to chain
 *   pending           — broadcast confirmed, watcher hasn't seen it yet
 *   confirming        — watcher saw it, finalizing
 *   confirmed         — done, grant code minted
 *   expired           — session TTL elapsed before payment
 *   error             — anything went wrong; user can retry
 */

import { useTranslations } from 'next-intl';
import { Loader2, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';

export type StatusValue =
  | 'idle'
  | 'creating'
  | 'awaiting_wallet'
  | 'broadcasting'
  | 'pending'
  | 'confirming'
  | 'confirmed'
  | 'expired'
  | 'error';

interface PaymentStatusProps {
  status: StatusValue;
  reason?: string;
  retry?: () => void;
}

/**
 * Map opaque engine/site error tokens to a localized human sentence.
 * Falls back to the raw reason string if no mapping exists, so unknown
 * errors are still surfaced (debuggable) without crashing.
 */
function humanizeReason(
  reason: string | undefined,
  t: ReturnType<typeof useTranslations<'pay.status'>>,
  status: StatusValue,
): string {
  if (!reason) return t(`${status}.body`, { reason: '' });

  // Known reasons emitted by /api/payment/session and the site's
  // session.ts helpers. Each gets a clear, actionable explanation.
  const KNOWN: Record<string, string> = {
    feature_disabled: t('reasons.featureDisabled'),
    engine_offline: t('reasons.engineOffline'),
    engine_error: t('reasons.engineError'),
    invalid_input: t('reasons.invalidInput'),
    invalid_tier_cadence: t('reasons.invalidInput'),
    unsupported_chain: t('reasons.unsupportedChain'),
    price_lookup_failed: t('reasons.priceLookup'),
    session_failed: t('reasons.sessionFailed'),
    engine_marked_failed: t('reasons.engineMarkedFailed'),
    mint_not_configured: t('reasons.mintNotConfigured'),
    wallet_not_connected: t('reasons.walletNotConnected'),
  };
  const mapped = KNOWN[reason];
  if (mapped) return mapped;
  return t(`${status}.body`, { reason });
}

const STATE_TONE: Record<StatusValue, 'neutral' | 'pending' | 'success' | 'error'> =
  {
    idle: 'neutral',
    creating: 'pending',
    awaiting_wallet: 'pending',
    broadcasting: 'pending',
    pending: 'pending',
    confirming: 'pending',
    confirmed: 'success',
    expired: 'error',
    error: 'error',
  };

const TONE_COLOR: Record<'neutral' | 'pending' | 'success' | 'error', string> = {
  neutral: 'var(--fg-3)',
  pending: 'var(--accent)',
  success: 'var(--accent)',
  error: 'var(--danger)',
};

export function PaymentStatus({ status, reason, retry }: PaymentStatusProps) {
  const t = useTranslations('pay.status');
  if (status === 'idle') return null;

  const tone = STATE_TONE[status];
  const color = TONE_COLOR[tone];
  const isError = tone === 'error';
  const isSuccess = tone === 'success';
  const isPending = tone === 'pending';

  return (
    <div
      className="border border-[var(--border)] bg-[var(--surface)] px-4 py-3 flex items-center gap-3"
      role="status"
      aria-live="polite"
    >
      <span style={{ color }} className="flex-none">
        {isPending && <Loader2 size={16} strokeWidth={2} className="animate-spin" />}
        {isSuccess && <CheckCircle2 size={16} strokeWidth={2} />}
        {isError && status === 'expired' && <Clock size={16} strokeWidth={2} />}
        {isError && status !== 'expired' && (
          <AlertTriangle size={16} strokeWidth={2} />
        )}
      </span>
      <div className="flex-1 min-w-0">
        <p
          className="mono tabular text-[10.5px] uppercase tracking-[0.16em]"
          style={{ color }}
        >
          {t(`${status}.label`)}
        </p>
        <p className="text-[12.5px] text-[var(--fg-2)] leading-relaxed">
          {humanizeReason(reason, t, status)}
        </p>
      </div>
      {(isError || status === 'expired') && retry && (
        <button
          type="button"
          onClick={retry}
          className="mono tabular text-[10px] uppercase tracking-[0.14em] border border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)] px-2.5 py-1.5 hover:opacity-90 transition-opacity"
        >
          {t('retry')}
        </button>
      )}
    </div>
  );
}
