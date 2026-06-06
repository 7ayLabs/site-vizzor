'use client';

/**
 * PaymentStatus — visible state of the payment lifecycle.
 *
 * The component is intentionally presentational: it accepts a discrete
 * `status` and an optional `reason`, picks the right copy via the
 * `pay.state` namespace and the centralized error taxonomy in
 * `lib/payment/errors.ts`, and renders a banner with an aria-live
 * region so screen readers announce state changes as they happen.
 *
 * Behavioral classes (drawn from `classifyReason()`) drive the
 * banner's tone and CTA:
 *   - 'infra-pending' → neutral info banner + "Pay in Telegram"
 *   - 'transient'     → amber pending banner + Retry
 *   - 'fatal'         → red error banner + Retry
 *   - 'user-action'   → amber banner, no Retry (user must act)
 */

import { useTranslations } from 'next-intl';
import { Loader2, CheckCircle2, AlertTriangle, Clock, Info } from 'lucide-react';
import type { PaymentCadence, PaymentTier } from '@/lib/payment/session';
import {
  classifyReason,
  mapReasonToCopyKey,
  type ReasonClass,
} from '@/lib/payment/errors';

/**
 * Visible status values. Mirrors `PurchaseState['kind']` from
 * `purchase-state.ts` but kept independent so this component remains
 * presentational and reusable outside the checkout shell.
 */
export type StatusValue =
  | 'idle'
  | 'connecting'
  | 'wrong-network'
  | 'signing'
  | 'paying'
  | 'confirming'
  | 'done'
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

type Tone = 'neutral' | 'pending' | 'success' | 'error' | 'info';

const STATE_TONE: Record<StatusValue, Tone> = {
  idle: 'neutral',
  connecting: 'pending',
  'wrong-network': 'info',
  signing: 'pending',
  paying: 'pending',
  confirming: 'pending',
  done: 'success',
  expired: 'error',
  error: 'error',
};

const TONE_COLOR: Record<Tone, string> = {
  neutral: 'var(--fg-3)',
  pending: 'var(--accent)',
  success: 'var(--accent)',
  error: 'var(--danger)',
  info: 'var(--fg-2)',
};

function resolveCopy(
  status: StatusValue,
  reason: string | undefined,
  state: ReturnType<typeof useTranslations<'pay.state'>>,
  errorNs: ReturnType<typeof useTranslations<'pay.error'>>,
): string {
  if (reason) {
    const key = mapReasonToCopyKey(reason);
    return errorNs(key);
  }
  return state(`${status}.body`);
}

export function PaymentStatus({
  status,
  reason,
  retry,
  tier,
  cadence,
}: PaymentStatusProps) {
  const stateNs = useTranslations('pay.state');
  const errorNs = useTranslations('pay.error');

  if (status === 'idle') return null;

  const stateTone = STATE_TONE[status];
  const reasonClass: ReasonClass | null = reason ? classifyReason(reason) : null;

  // Infra-pending demotes the visual tone from error red to neutral
  // info — it's not a failure, it's a deployment phase.
  const isInfraPending = reasonClass === 'infra-pending';
  const isUserAction = reasonClass === 'user-action';

  const tone: Tone = isInfraPending
    ? 'info'
    : isUserAction
      ? 'pending'
      : stateTone;

  const color = TONE_COLOR[tone];
  const isError = stateTone === 'error' && !isInfraPending && !isUserAction;
  const isSuccess = stateTone === 'success';
  const isPending = tone === 'pending';

  // For non-error states, derive the label from `pay.state.<status>`.
  // For error / expired states, prefer the error namespace label if a
  // recognized reason is present, otherwise the state label.
  let label: string;
  if (isInfraPending) {
    label = errorNs('infraPendingLabel');
  } else if (reason && (status === 'error' || status === 'expired')) {
    label = stateNs(`${status}.label`);
  } else {
    label = stateNs(`${status}.label`);
  }

  const body = resolveCopy(status, reason, stateNs, errorNs);

  const telegramHref =
    tier && cadence
      ? `https://t.me/vizzorai_bot?start=pay_${tier}_${cadence}`
      : 'https://t.me/vizzorai_bot';

  return (
    <div
      className="border border-[var(--border)] bg-[var(--surface)] px-4 py-3 flex items-start gap-3"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span style={{ color }} className="flex-none pt-0.5" aria-hidden>
        {isPending && (
          <Loader2 size={16} strokeWidth={2} className="animate-spin motion-reduce:animate-none" />
        )}
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
          {label}
        </p>
        <p className="text-[12.5px] text-[var(--fg-2)] leading-relaxed">{body}</p>
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
              <span>{errorNs('payInTelegram')}</span>
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
                {errorNs('retryAnyway')}
              </button>
            )}
          </div>
        )}
      </div>
      {!isInfraPending && !isUserAction && (isError || status === 'expired') && retry && (
        <button
          type="button"
          onClick={retry}
          className="mono tabular text-[10px] uppercase tracking-[0.14em] border border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)] px-2.5 py-1.5 hover:opacity-90 transition-opacity"
        >
          {stateNs('retry')}
        </button>
      )}
    </div>
  );
}
