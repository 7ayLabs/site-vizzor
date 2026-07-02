'use client';

/**
 * TransactionDetailsSheet — right-side sheet showing full audit
 * details for a single capability intent.
 *
 * Design intent: replace the previous "clicking a row jumped back
 * into the conversation" behavior. That flow was confusing — the
 * user wanted to read the transaction, not re-enter a chat. This
 * sheet keeps them on /app/transactions with every field visible:
 * from/to/amount/symbol/kind/status/tx hash/timeline
 * (issued/signed/executed timestamps). The conversation link is
 * present but demoted to a small footer link.
 *
 * Non-goals:
 *   - No broadcast / re-sign action inside the sheet. That belongs
 *     in the composer's IntentChatCard (which handles wallet-adapter
 *     lifecycle + canonical bytes). This sheet is read-only.
 */

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { CoinIcon } from '@/components/ui/coin-icon';
import type { TxIntent } from '@/components/app/transactions-list';

interface Props {
  intent: TxIntent | null;
  onClose: () => void;
}

export function TransactionDetailsSheet({ intent, onClose }: Props) {
  const t = useTranslations('predict.transactions');
  const tStatus = useTranslations('predict.transactions.status');

  // Escape closes.
  useEffect(() => {
    if (!intent) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [intent, onClose]);

  if (!intent) return null;

  const explorer = intent.tx_hash
    ? intent.network === 'sol'
      ? `https://solscan.io/tx/${intent.tx_hash}${
          process.env.NEXT_PUBLIC_PAYMENT_NETWORK === 'mainnet'
            ? ''
            : '?cluster=devnet'
        }`
      : `https://tonviewer.com/transaction/${intent.tx_hash}`
    : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        'fixed inset-0 z-[70]',
        'flex justify-end',
        'bg-[color-mix(in_oklab,var(--bg)_55%,transparent)]',
        'backdrop-blur-[3px]',
        'motion-safe:vz-fade-in',
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className={cn(
          'relative flex flex-col h-full w-full max-w-[420px]',
          'bg-[var(--surface)]',
          'border-l border-[var(--border)]',
          'motion-safe:vz-tx-sheet-in',
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 px-5 py-4 border-b border-[var(--border)]">
          <div className="min-w-0">
            <p className="mono tabular text-[9.5px] uppercase tracking-[0.22em] text-[var(--fg-3)]">
              {t(`kinds.${intent.kind}`)}
            </p>
            <div className="mt-1 inline-flex items-center gap-2">
              <CoinIcon symbol={intent.symbol ?? '?'} size={16} />
              <span className="mono tabular text-[15px] font-semibold text-[var(--fg)]">
                {intent.amount ?? '—'} {intent.symbol ?? ''}
              </span>
            </div>
            <div className="mt-2 inline-flex items-center gap-1.5">
              <StatusBadge status={intent.status} label={tStatus(intent.status)} />
              <span className="mono tabular text-[9.5px] text-[var(--fg-3)]">
                #{shortIntentId(intent.intent_id)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('sheet.close')}
            className={cn(
              'shrink-0 inline-flex items-center justify-center',
              'h-8 w-8 rounded-lg',
              'text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]',
              'transition-colors',
            )}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* Addresses */}
          <Field label={t('sheet.from')}>
            <span className="mono tabular text-[11px] text-[var(--fg)] break-all">
              {intent.from_addr ?? '—'}
            </span>
          </Field>
          <Field label={t('sheet.to')}>
            <span className="mono tabular text-[11px] text-[var(--fg)] break-all">
              {intent.to_addr ?? '—'}
            </span>
          </Field>

          {/* Network + amount USD */}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('sheet.network')}>
              <span className="mono tabular text-[11px] text-[var(--fg)] uppercase">
                {intent.network}
              </span>
            </Field>
            {typeof intent.amount_usd === 'number' && (
              <Field label={t('sheet.amountUsd')}>
                <span className="mono tabular text-[11px] text-[var(--fg)]">
                  ~${intent.amount_usd.toFixed(2)}
                </span>
              </Field>
            )}
          </div>

          {/* Scheduled execute_at (payment only) */}
          {intent.kind === 'payment' &&
            typeof intent.execute_at === 'number' && (
              <Field label={t('sheet.scheduledFor')}>
                <span className="mono tabular text-[11px] text-[var(--fg)]">
                  {new Date(intent.execute_at).toLocaleString(undefined, {
                    hour12: false,
                  })}
                </span>
              </Field>
            )}

          {/* Tx hash */}
          {explorer && intent.tx_hash && (
            <Field label={t('sheet.txHash')}>
              <a
                href={explorer}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'mono tabular text-[11px] text-[var(--up)] hover:opacity-90',
                  'underline underline-offset-2 break-all inline-flex items-center gap-1',
                )}
              >
                {intent.tx_hash.slice(0, 8)}…{intent.tx_hash.slice(-8)}
                <span aria-hidden>↗</span>
              </a>
            </Field>
          )}

          {/* Timeline */}
          <div className="mt-2">
            <p className="mono tabular text-[9.5px] uppercase tracking-[0.22em] text-[var(--fg-3)] mb-2">
              {t('sheet.timeline')}
            </p>
            <ol className="flex flex-col gap-1.5">
              <TimelineRow
                label={t('sheet.timelineEvents.issued')}
                at={intent.issued_at}
              />
              {intent.signed_at && (
                <TimelineRow
                  label={t('sheet.timelineEvents.signed')}
                  at={intent.signed_at}
                />
              )}
              {intent.executed_at && (
                <TimelineRow
                  label={t('sheet.timelineEvents.executed')}
                  at={intent.executed_at}
                />
              )}
              {intent.status === 'expired' && (
                <TimelineRow
                  label={t('sheet.timelineEvents.expired')}
                  at={intent.ttl_at}
                />
              )}
            </ol>
          </div>
        </div>

        {/* Footer — conversation link (demoted) */}
        {intent.conversation_id && (
          <div className="border-t border-[var(--border)] px-5 py-3">
            <Link
              href={
                `/app/predict?conversation=${encodeURIComponent(intent.conversation_id)}` as never
              }
              className={cn(
                'inline-flex items-center gap-1',
                'mono tabular text-[10.5px] uppercase tracking-[0.16em]',
                'text-[var(--fg-3)] hover:text-[var(--fg)] transition-colors',
              )}
            >
              {t('sheet.openConversation')}
              <span aria-hidden>→</span>
            </Link>
          </div>
        )}
      </aside>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="mono tabular text-[9.5px] uppercase tracking-[0.22em] text-[var(--fg-3)]">
        {label}
      </span>
      {children}
    </div>
  );
}

function TimelineRow({ label, at }: { label: string; at: number }) {
  return (
    <li className="flex items-center justify-between gap-3 text-[10.5px]">
      <span className="text-[var(--fg-2)]">{label}</span>
      <span className="mono tabular text-[var(--fg-3)]">
        {new Date(at).toLocaleString(undefined, { hour12: false })}
      </span>
    </li>
  );
}

function StatusBadge({
  status,
  label,
}: {
  status: TxIntent['status'];
  label: string;
}) {
  const tone =
    status === 'executed'
      ? 'border border-[color-mix(in_oklab,var(--up)_45%,var(--border))] text-[var(--up)] bg-[color-mix(in_oklab,var(--up)_10%,transparent)]'
      : status === 'failed'
        ? 'border border-[color-mix(in_oklab,var(--down)_45%,var(--border))] text-[var(--down)] bg-[color-mix(in_oklab,var(--down)_10%,transparent)]'
        : status === 'pending'
          ? 'border border-[color-mix(in_oklab,var(--accent)_50%,var(--border))] text-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]'
          : status === 'signed'
            ? 'border border-[var(--border)] text-[var(--fg-2)] bg-[color-mix(in_oklab,var(--fg)_4%,transparent)]'
            : 'border border-[var(--border)] text-[var(--fg-3)] bg-transparent';
  return (
    <span
      className={cn(
        'inline-flex items-center h-[16px] px-1.5 rounded-full',
        'mono tabular text-[9.5px] uppercase tracking-[0.16em] font-semibold',
        tone,
      )}
    >
      {label}
    </span>
  );
}

function shortIntentId(id: string): string {
  const stripped = id.replace(/^itn_/, '');
  if (stripped.length <= 8) return stripped;
  return `${stripped.slice(0, 4)}…${stripped.slice(-4)}`;
}
