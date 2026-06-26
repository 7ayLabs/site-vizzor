'use client';

/**
 * PaymentHistoryList — confirmed payment sessions for the active wallet.
 *
 * Fetches /api/payment/history (SIWS-gated, wallet-scoped server-side)
 * and renders one row per confirmed payment with: chain badge, amount
 * + token, USD value, relative timestamp, and an explorer link built
 * from `lib/explorer/{solana,ton}.ts`. Stays graceful when the user
 * has no payment history yet.
 */

import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { ArrowUpRight } from 'lucide-react';
import { paymentNetwork } from '@/lib/payment/network';
import { buildSolscanTxUrl } from '@/lib/explorer/solana';
import { buildTonviewerTxUrl } from '@/lib/explorer/ton';

interface PaymentSession {
  sessionId: string;
  tier: string;
  cadence: string;
  chain: string;
  token: string;
  amount: number;
  decimals: number;
  amountUsdCents: number;
  confirmedAt: number | null;
  txSig: string | null;
}

interface HistoryResponse {
  ok: boolean;
  sessions: PaymentSession[];
}

const fetcher = async (url: string): Promise<HistoryResponse> => {
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<HistoryResponse>;
};

function explorerUrl(s: PaymentSession): string | null {
  if (!s.txSig) return null;
  const net = paymentNetwork();
  if (s.chain === 'solana') return buildSolscanTxUrl(s.txSig, net);
  if (s.chain === 'ton') return buildTonviewerTxUrl(s.txSig, net);
  return null;
}

function relativeTime(timestamp: number | null, locale: string): string {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatAmount(s: PaymentSession): string {
  const scaled = s.amount / Math.pow(10, s.decimals);
  // 4 significant digits trims the long tail without dropping precision
  // for small SOL amounts (e.g. 0.0234 SOL stays readable).
  return scaled.toLocaleString(undefined, { maximumSignificantDigits: 4 });
}

function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
  });
}

export function PaymentHistoryList() {
  const t = useTranslations('app.billing.history');
  const { data, error, isLoading } = useSWR<HistoryResponse>(
    '/api/payment/history',
    fetcher,
    {
      refreshInterval: 20_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
      shouldRetryOnError: false,
    },
  );

  if (isLoading && !data) {
    return (
      <p className="text-[13px] text-[var(--fg-3)]">{t('loading')}</p>
    );
  }
  if (error || !data?.ok) {
    return (
      <p className="text-[13px] text-[var(--fg-3)]">{t('error')}</p>
    );
  }
  if (data.sessions.length === 0) {
    return (
      <p className="text-[13px] text-[var(--fg-3)]">{t('empty')}</p>
    );
  }

  // Use the bundle locale resolver from navigator for client-side dates;
  // the server-rendered shell already locked the URL locale via
  // setRequestLocale, but `toLocaleString` for relative time formatting
  // is purely a UI nicety so undefined (browser default) is fine here.
  const locale =
    typeof navigator !== 'undefined' ? navigator.language : 'en-US';

  return (
    <ul className="flex flex-col divide-y divide-[var(--border)]">
      {data.sessions.map((s) => {
        const link = explorerUrl(s);
        return (
          <li
            key={s.sessionId}
            className="py-4 flex items-start gap-4 sm:items-center sm:flex-row flex-col sm:gap-6"
          >
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-[var(--fg)]">
                {t('row.title', {
                  tier: capitalize(s.tier),
                  cadence: s.cadence,
                })}
              </p>
              <p className="mono tabular text-[11px] text-[var(--fg-3)] mt-0.5">
                {relativeTime(s.confirmedAt, locale)} ·{' '}
                <span className="uppercase tracking-[0.12em]">{s.chain}</span>
              </p>
            </div>

            <div className="flex flex-col items-end">
              <p className="mono tabular text-[13px] text-[var(--fg)]">
                {formatAmount(s)} {s.token.toUpperCase()}
              </p>
              <p className="mono tabular text-[11px] text-[var(--fg-3)]">
                {formatUsd(s.amountUsdCents)}
              </p>
            </div>

            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="
                  inline-flex items-center gap-1 text-[12px]
                  text-[var(--fg-2)] hover:text-[var(--fg)]
                  transition-colors
                "
              >
                <span>{t('row.explorer')}</span>
                <ArrowUpRight size={12} strokeWidth={2} />
              </a>
            ) : (
              <span className="text-[11px] text-[var(--fg-3)]">—</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
