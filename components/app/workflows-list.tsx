'use client';

/**
 * WorkflowsList — client-side reader for `/api/workflows`.
 *
 * Renders one card per conversation with its child intents beneath.
 * Empty state, error state, and unauthenticated state all share the
 * same minimalist card chrome so nothing feels like an outlier when
 * the wallet has nothing pending. Terminal statuses (executed,
 * failed, expired) render alongside pending ones — this is the
 * user's audit surface, not just the "todo" view.
 *
 * No polling — the page is reactive to user action (submit an
 * intent → refetch on window focus) rather than time. Keeps the
 * request budget calm and matches the alert-page cadence.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CoinIcon } from '@/components/ui/coin-icon';
import { cn } from '@/lib/utils';
import type { CapId } from '@/lib/capabilities/intent';
import { TradeTag } from '@/components/predict/trade-tag';

type IntentStatus =
  | 'pending'
  | 'signed'
  | 'executed'
  | 'failed'
  | 'expired';

interface WorkflowIntent {
  intent_id: string;
  kind: CapId;
  network: string;
  symbol: string | null;
  amount: string | null;
  amount_usd: number | null;
  from_addr: string | null;
  to_addr: string | null;
  status: IntentStatus;
  tx_hash: string | null;
  ttl_at: number;
  issued_at: number;
  signed_at: number | null;
  executed_at: number | null;
  created_at: number;
}

interface WorkflowGroup {
  conversation_id: string | null;
  conversation_title: string | null;
  intents: WorkflowIntent[];
}

type FetchState =
  | { kind: 'loading' }
  | { kind: 'unauthenticated' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; groups: WorkflowGroup[] };

function shortAddr(a: string | null): string {
  if (!a) return '—';
  if (a.length <= 12) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function explorerUrl(network: string, sig: string): string {
  const cluster =
    process.env.NEXT_PUBLIC_PAYMENT_NETWORK === 'mainnet'
      ? ''
      : '?cluster=devnet';
  if (network === 'sol') {
    return `https://solscan.io/tx/${sig}${cluster}`;
  }
  return `https://tonviewer.com/transaction/${sig}`;
}

export function WorkflowsList() {
  const t = useTranslations('predict.workflows');
  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/workflows', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (res.status === 401) {
        setState({ kind: 'unauthenticated' });
        return;
      }
      const data = (await res.json()) as
        | { ok: true; groups: WorkflowGroup[] }
        | { ok: false; reason?: string };
      if (!res.ok || data.ok === false) {
        setState({
          kind: 'error',
          message:
            data.ok === false ? (data.reason ?? 'error') : `http_${res.status}`,
        });
        return;
      }
      setState({ kind: 'ok', groups: data.groups });
    } catch (e) {
      setState({
        kind: 'error',
        message: e instanceof Error ? e.message : 'network',
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  if (state.kind === 'loading') {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-[12px] text-[var(--fg-3)]">
        …
      </div>
    );
  }
  if (state.kind === 'unauthenticated') {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-[12.5px] text-[var(--fg-2)] leading-relaxed">
        {t('unauthenticated')}
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--down)_10%,transparent)] px-4 py-6 text-[12.5px] text-[var(--down)] leading-relaxed">
        {state.message}
      </div>
    );
  }
  if (state.groups.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-[12.5px] text-[var(--fg-2)] leading-relaxed">
        {t('empty')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {state.groups.map((g) => (
        <WorkflowGroupCard key={g.conversation_id ?? '__unlinked__'} group={g} />
      ))}
    </div>
  );
}

function WorkflowGroupCard({ group }: { group: WorkflowGroup }) {
  const t = useTranslations('predict.workflows');
  const title = group.conversation_title ?? t('unlinked');
  const activeCount = group.intents.filter(
    (i) => i.status === 'pending' || i.status === 'signed',
  ).length;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3.5 py-2.5">
        <div className="min-w-0 flex items-center gap-2">
          {group.conversation_id ? (
            <Link
              href={`/app/predict?conversation=${encodeURIComponent(group.conversation_id)}` as never}
              className="text-[12.5px] font-medium text-[var(--fg)] hover:opacity-80 truncate"
            >
              {title}
            </Link>
          ) : (
            <span className="text-[12.5px] font-medium text-[var(--fg-3)] truncate">
              {title}
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <span className="shrink-0 mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--accent)]">
            {t('activeBadge', { count: activeCount })}
          </span>
        )}
      </div>
      <div className="divide-y divide-[var(--border)]">
        {group.intents.map((i) => (
          <IntentRow key={i.intent_id} intent={i} />
        ))}
      </div>
    </div>
  );
}

function IntentRow({ intent }: { intent: WorkflowIntent }) {
  return (
    <div className="px-3.5 py-3 flex flex-col gap-1.5">
      {/* TradeTag carries id + kind + amount + status in one row so
          the same visual language reads across intent-card, workflows
          page, and alerts drawer. */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <TradeTag
          intentId={intent.intent_id}
          kind={intent.kind}
          symbol={intent.symbol ?? '?'}
          amount={intent.amount ?? '—'}
          status={intent.status}
        />
      </div>
      <div className="min-w-0 text-[10.5px] text-[var(--fg-3)] mono tabular flex items-center gap-1">
        <span>{shortAddr(intent.from_addr)}</span>
        <span aria-hidden>→</span>
        <span className="truncate">{shortAddr(intent.to_addr)}</span>
      </div>
      <div className="min-w-0 text-[9.5px] mono tabular text-[var(--fg-3)] flex items-center gap-2">
        {intent.tx_hash && (
          <>
            <a
              href={explorerUrl(intent.network, intent.tx_hash)}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--up)] underline underline-offset-2 truncate"
            >
              {intent.tx_hash.slice(0, 8)}…{intent.tx_hash.slice(-8)}
            </a>
            <span aria-hidden>·</span>
          </>
        )}
        <span>{new Date(intent.created_at).toLocaleString()}</span>
      </div>
    </div>
  );
}

