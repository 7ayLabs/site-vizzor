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
 *
 * Special case: `reason === 'engine_error'` is not a true failure — it
 * means the engine endpoint isn't deployed yet (e.g. payment infra is
 * pending). The banner pivots to a neutral "infrastructure pending"
 * tone with a constructive "Pay in Telegram" CTA instead of a red
 * Retry that won't help.
 */

import { useTranslations } from 'next-intl';
import { Loader2, CheckCircle2, AlertTriangle, Clock, Info } from 'lucide-react';
import type { PaymentCadence, PaymentTier } from '@/lib/payment/session';

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
  /** Tier + cadence used to build the contextual Telegram fallback link. */
  tier?: PaymentTier;
  cadence?: PaymentCadence;
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

const TONE_COLOR: Record<'neutral' | 'pending' | 'success' | 'error' | 'info', string> = {
  neutral: 'var(--fg-3)',
  pending: 'var(--accent)',
  success: 'var(--accent)',
  error: 'var(--danger)',
  info: 'var(--fg-2)',
};

/**
 * Engine error tokens that represent "infrastructure pending" rather
 * than a true failure. These get the info tone + Telegram fallback CTA
 * instead of a red Retry.
 */
const INFRA_PENDING_REASONS = new Set([
  'engine_error',
  'engine_offline',
  'feature_disabled',
  'mint_not_configured',
]);

function humanizeReason(
  reason: string | undefined,
  t: ReturnType<typeof useTranslations<'pay.status'>>,
  status: StatusValue,
): string {
  if (!reason) return t(`${status}.body`, { reason: '' });

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

export function PaymentStatus({
  status,
  reason,
  retry,
  tier,
  cadence,
}: PaymentStatusProps) {
  const t = useTranslations('pay.status');
  if (status === 'idle') return null;

  const baseTone = STATE_TONE[status];
  const isInfraPending =
    baseTone === 'error' && reason !== undefined && INFRA_PENDING_REASONS.has(reason);

  // The infra-pending case demotes from "error red" to neutral "info" —
  // it's not a failure, it's a deployment phase.
  const tone = isInfraPending ? 'info' : baseTone;
  const color = TONE_COLOR[tone];
  const isError = baseTone === 'error' && !isInfraPending;
  const isSuccess = baseTone === 'success';
  const isPending = baseTone === 'pending';

  const telegramHref =
    tier && cadence
      ? `https://t.me/vizzorai_bot?start=pay_${tier}_${cadence}`
      : 'https://t.me/vizzorai_bot';

  return (
    <div
      className={`
        border bg-[var(--surface)] px-4 py-3 flex items-start gap-3
        ${isInfraPending ? 'border-[var(--border)]' : 'border-[var(--border)]'}
      `}
      role="status"
      aria-live="polite"
    >
      <span style={{ color }} className="flex-none pt-0.5">
        {isPending && <Loader2 size={16} strokeWidth={2} className="animate-spin" />}
        {isSuccess && <CheckCircle2 size={16} strokeWidth={2} />}
        {isInfraPending && <Info size={16} strokeWidth={2} />}
        {isError && status === 'expired' && <Clock size={16} strokeWidth={2} />}
        {isError && status !== 'expired' && (
          <AlertTriangle size={16} strokeWidth={2} />
        )}
      </span>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <p
          className="mono tabular text-[10.5px] uppercase tracking-[0.16em]"
          style={{ color }}
        >
          {isInfraPending ? t('reasons.infraPendingLabel') : t(`${status}.label`)}
        </p>
        <p className="text-[12.5px] text-[var(--fg-2)] leading-relaxed">
          {humanizeReason(reason, t, status)}
        </p>
        {isInfraPending && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a
              href={telegramHref}
              target="_blank"
              rel="noopener"
              className="
                inline-flex items-center justify-center gap-1.5 h-9 px-3
                mono tabular text-[10.5px] uppercase tracking-[0.14em]
                bg-[var(--fg)] text-[var(--bg)]
                hover:opacity-90 transition-opacity
              "
            >
              <span>{t('reasons.payInTelegram')}</span>
              <span aria-hidden>→</span>
            </a>
            {retry && (
              <button
                type="button"
                onClick={retry}
                className="
                  mono tabular text-[10px] uppercase tracking-[0.14em]
                  text-[var(--fg-3)] hover:text-[var(--fg)]
                  underline-offset-4 hover:underline transition-colors
                "
              >
                {t('reasons.retryAnyway')}
              </button>
            )}
          </div>
        )}
      </div>
      {!isInfraPending && (isError || status === 'expired') && retry && (
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
