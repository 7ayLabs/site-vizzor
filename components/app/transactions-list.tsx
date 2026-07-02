'use client';

/**
 * TransactionsList — the v0.5.3 rebuild of the /app/workflows page.
 *
 * Design brief (2026-07): the old grouped-by-conversation layout read
 * as a list of empty rectangles; users didn't know what to click or
 * what was actionable. The new surface is a single flat row list
 * ordered by ACTION PRIORITY (things awaiting the wallet first,
 * terminal receipts last), with a search input + status + kind
 * filters, and a right-side details sheet that opens on row click —
 * NEVER navigating back into the chat (the old behavior conflated
 * "audit this transaction" with "re-enter the conversation").
 *
 * Notification side effects:
 *   - On mount, mark every unread notification in the `workflows`
 *     bucket as read. Visiting this page IS the "seen" signal — the
 *     sidebar badge drops to 0 on the next poll cycle.
 *   - On row click, additionally mark any per-intent notification
 *     with the matching `ref_id` as read (redundant with the bucket
 *     wipe, but idempotent + safe if the mount effect raced).
 *
 * Data path stays on `/api/workflows` — no route rename in this cut;
 * the URL swap already delivers the user-visible change and touching
 * the API surface would break every consumer (chat delete guard,
 * existing SWR hook) for no gain.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CoinIcon } from '@/components/ui/coin-icon';
import { cn } from '@/lib/utils';
import type { CapId } from '@/lib/capabilities/intent';
import { TransactionDetailsSheet } from '@/components/app/transaction-details-sheet';
import { useNotifications } from '@/lib/notifications/use-notifications';

type IntentStatus =
  | 'pending'
  | 'signed'
  | 'executed'
  | 'failed'
  | 'expired';

export interface TxIntent {
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
  conversation_id: string | null;
  conversation_title: string | null;
  execute_at?: number | null;
}

interface ApiIntent {
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
  execute_at?: number | null;
}

interface WorkflowGroup {
  conversation_id: string | null;
  conversation_title: string | null;
  intents: ApiIntent[];
}

type FetchState =
  | { kind: 'loading' }
  | { kind: 'unauthenticated' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; intents: TxIntent[] };

type StatusFilter = 'all' | IntentStatus | 'action';
type KindFilter = 'all' | CapId;

/** Priority-first sort key so actionable intents float to the top.
 *  Same numeric scale used by the mobile summary + sidebar badge. */
const STATUS_PRIORITY: Record<IntentStatus, number> = {
  pending: 100,
  signed: 80,
  executed: 40,
  failed: 20,
  expired: 10,
};

export function TransactionsList() {
  const t = useTranslations('predict.transactions');
  const [state, setState] = useState<FetchState>({ kind: 'loading' });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('action');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<TxIntent | null>(null);

  const { markAllRead: markAllNotifRead, markRead: markNotifRead, items: notifItems } =
    useNotifications({ enabled: true });

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
      // Flatten conversation groups → one row per intent. Preserve the
      // conversation title so the details sheet can show provenance
      // (without turning the row itself into a chat back-link, which
      // was the confusing behavior in the previous UI).
      const intents: TxIntent[] = [];
      for (const g of data.groups) {
        for (const it of g.intents) {
          intents.push({
            ...it,
            conversation_id: g.conversation_id,
            conversation_title: g.conversation_title,
          });
        }
      }
      setState({ kind: 'ok', intents });
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

  // v0.5.3 — visiting the page is the "seen" signal. Clear the
  // workflows bucket once per mount. Silent on error — the badge will
  // catch up on the next poll cycle.
  useEffect(() => {
    void markAllNotifRead('workflows');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (state.kind !== 'ok') return [];
    const q = query.trim().toLowerCase();
    return state.intents
      .filter((it) => {
        if (kindFilter !== 'all' && it.kind !== kindFilter) return false;
        if (statusFilter === 'action') {
          if (it.status !== 'pending' && it.status !== 'signed') return false;
        } else if (statusFilter !== 'all' && it.status !== statusFilter) {
          return false;
        }
        if (q.length > 0) {
          const hay = [
            it.intent_id,
            it.tx_hash ?? '',
            it.to_addr ?? '',
            it.from_addr ?? '',
            it.symbol ?? '',
            it.amount ?? '',
            it.conversation_title ?? '',
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const pa = STATUS_PRIORITY[a.status];
        const pb = STATUS_PRIORITY[b.status];
        if (pa !== pb) return pb - pa;
        return b.created_at - a.created_at;
      });
  }, [state, statusFilter, kindFilter, query]);

  const counts = useMemo(() => {
    if (state.kind !== 'ok') {
      return {
        all: 0,
        action: 0,
        pending: 0,
        signed: 0,
        executed: 0,
        failed: 0,
        expired: 0,
      };
    }
    const buckets = {
      all: state.intents.length,
      action: 0,
      pending: 0,
      signed: 0,
      executed: 0,
      failed: 0,
      expired: 0,
    };
    for (const it of state.intents) {
      buckets[it.status] += 1;
      if (it.status === 'pending' || it.status === 'signed') buckets.action += 1;
    }
    return buckets;
  }, [state]);

  const openDetails = useCallback(
    (intent: TxIntent) => {
      setSelected(intent);
      const linkedIds = notifItems
        .filter(
          (n) =>
            n.ref_id === intent.intent_id &&
            n.read_at === null &&
            (n.kind === 'workflow_executed' ||
              n.kind === 'workflow_failed' ||
              n.kind === 'payment_due'),
        )
        .map((n) => n.id);
      if (linkedIds.length > 0) {
        void markNotifRead(linkedIds);
      }
    },
    [notifItems, markNotifRead],
  );

  if (state.kind === 'loading') {
    return (
      <div className="px-1 py-8 text-[11.5px] text-[var(--fg-3)] mono tabular">
        …
      </div>
    );
  }
  if (state.kind === 'unauthenticated') {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-[12.5px] text-[var(--fg-2)] leading-relaxed">
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

  const empty = state.intents.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar: search + status pills + kind pills. Collapses to a
          single stacked column below sm. */}
      <div className="flex flex-col gap-2.5">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t('search.placeholder')}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterGroup label={t('filters.status')}>
            <Pill
              active={statusFilter === 'action'}
              onClick={() => setStatusFilter('action')}
              badge={counts.action}
            >
              {t('filters.action')}
            </Pill>
            <Pill
              active={statusFilter === 'all'}
              onClick={() => setStatusFilter('all')}
              badge={counts.all}
            >
              {t('filters.all')}
            </Pill>
            <Pill
              active={statusFilter === 'pending'}
              onClick={() => setStatusFilter('pending')}
              badge={counts.pending || undefined}
              tone="accent"
            >
              {t('status.pending')}
            </Pill>
            <Pill
              active={statusFilter === 'signed'}
              onClick={() => setStatusFilter('signed')}
              badge={counts.signed || undefined}
            >
              {t('status.signed')}
            </Pill>
            <Pill
              active={statusFilter === 'executed'}
              onClick={() => setStatusFilter('executed')}
              badge={counts.executed || undefined}
              tone="up"
            >
              {t('status.executed')}
            </Pill>
            <Pill
              active={statusFilter === 'failed'}
              onClick={() => setStatusFilter('failed')}
              badge={counts.failed || undefined}
              tone="down"
            >
              {t('status.failed')}
            </Pill>
            <Pill
              active={statusFilter === 'expired'}
              onClick={() => setStatusFilter('expired')}
              badge={counts.expired || undefined}
              tone="muted"
            >
              {t('status.expired')}
            </Pill>
          </FilterGroup>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterGroup label={t('filters.kind')}>
            <Pill active={kindFilter === 'all'} onClick={() => setKindFilter('all')}>
              {t('filters.all')}
            </Pill>
            <Pill
              active={kindFilter === 'transfer'}
              onClick={() => setKindFilter('transfer')}
            >
              {t('kinds.transfer')}
            </Pill>
            <Pill
              active={kindFilter === 'payment'}
              onClick={() => setKindFilter('payment')}
            >
              {t('kinds.payment')}
            </Pill>
          </FilterGroup>
        </div>
      </div>

      {/* List. Uses a semantic list role for screen readers. */}
      {empty ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-[12.5px] text-[var(--fg-2)] leading-relaxed text-center">
          {t('empty')}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-[12.5px] text-[var(--fg-2)] leading-relaxed text-center">
          {t('noMatches')}
        </div>
      ) : (
        <ul
          className="flex flex-col divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] overflow-hidden"
          role="list"
        >
          {filtered.map((it, i) => (
            <TxRow
              key={it.intent_id}
              intent={it}
              index={i}
              onOpen={() => openDetails(it)}
            />
          ))}
        </ul>
      )}

      <TransactionDetailsSheet
        intent={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

/* ─────────────────────── Row ─────────────────────── */

function TxRow({
  intent,
  index,
  onOpen,
}: {
  intent: TxIntent;
  index: number;
  onOpen: () => void;
}) {
  const t = useTranslations('predict.transactions');
  const tStatus = useTranslations('predict.transactions.status');
  const direction = intent.kind === 'payment' ? 'schedule' : 'send';
  const symbol = intent.symbol ?? '—';
  const amount = intent.amount ?? '—';
  const to = shortAddr(intent.to_addr);
  const timeLabel = new Date(intent.created_at).toLocaleString(undefined, {
    hour12: false,
  });
  const statusTone = STATUS_TONE[intent.status];

  return (
    <li
      style={{
        animationDelay: `${Math.min(index * 30, 240)}ms`,
      }}
      className="motion-safe:vz-tx-row-in"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={t('row.aria', {
          amount,
          symbol,
          to,
          status: tStatus(intent.status),
        })}
        className={cn(
          'group w-full text-left',
          'flex items-center gap-3 px-3.5 py-3',
          'bg-transparent hover:bg-[color-mix(in_oklab,var(--fg)_4%,transparent)]',
          'active:bg-[color-mix(in_oklab,var(--fg)_6%,transparent)]',
          'transition-colors duration-150 ease-out',
          'focus:outline-none focus:bg-[color-mix(in_oklab,var(--fg)_5%,transparent)]',
        )}
      >
        {/* Direction glyph + amount */}
        <div className="shrink-0 flex items-center gap-2">
          <CoinIcon symbol={symbol} size={16} />
          <div className="min-w-0">
            <div className="mono tabular text-[12.5px] font-semibold text-[var(--fg)] leading-tight">
              {direction === 'schedule' ? '⏱ ' : '↗ '}
              {amount} {symbol}
            </div>
            <div className="mono tabular text-[10px] text-[var(--fg-3)] mt-0.5">
              → {to}
            </div>
          </div>
        </div>

        {/* Middle: kind + timestamp */}
        <div className="flex-1 min-w-0 hidden sm:block">
          <div className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
            {t(`kinds.${intent.kind}`)}
          </div>
          <div className="mono tabular text-[10.5px] text-[var(--fg-3)] mt-0.5">
            {timeLabel}
          </div>
        </div>

        {/* Status pill + chevron */}
        <div className="shrink-0 flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center h-[18px] px-1.5 rounded-full',
              'mono tabular text-[9.5px] uppercase tracking-[0.16em] font-semibold',
              statusTone,
            )}
          >
            {tStatus(intent.status)}
          </span>
          <span
            aria-hidden
            className="text-[var(--fg-3)] group-hover:text-[var(--fg-2)] transition-colors"
          >
            ›
          </span>
        </div>
      </button>
    </li>
  );
}

/* ─────────────────────── Toolbar atoms ─────────────────────── */

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-3)] text-[13px]"
      >
        ⌕
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full h-9 rounded-lg pl-9 pr-3',
          'text-[12.5px] text-[var(--fg)] placeholder:text-[var(--fg-3)]',
          'bg-[color-mix(in_oklab,var(--fg)_3%,transparent)]',
          'border border-[var(--border)]',
          'focus:outline-none focus:border-[var(--fg-2)]',
          'transition-colors',
        )}
      />
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--fg-3)] mr-1">
        {label}
      </span>
      {children}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
  badge,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number;
  tone?: 'accent' | 'up' | 'down' | 'muted';
}) {
  const activeTone =
    tone === 'accent'
      ? 'bg-[var(--accent)] text-[var(--bg)]'
      : tone === 'up'
        ? 'bg-[color-mix(in_oklab,var(--up)_28%,transparent)] text-[var(--fg)]'
        : tone === 'down'
          ? 'bg-[color-mix(in_oklab,var(--down)_28%,transparent)] text-[var(--fg)]'
          : tone === 'muted'
            ? 'bg-[color-mix(in_oklab,var(--fg-3)_20%,transparent)] text-[var(--fg-2)]'
            : 'bg-[var(--fg)] text-[var(--bg)]';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1 h-7 px-2.5 rounded-full',
        'mono tabular text-[10.5px] font-semibold uppercase tracking-[0.14em]',
        'transition-[background-color,color,box-shadow] duration-150 ease-out',
        'border border-transparent',
        active
          ? activeTone
          : 'text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[color-mix(in_oklab,var(--fg)_5%,transparent)]',
      )}
    >
      <span>{children}</span>
      {typeof badge === 'number' && badge > 0 && (
        <span
          className={cn(
            'inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full',
            'mono tabular text-[9px] font-semibold',
            active
              ? 'bg-[color-mix(in_oklab,var(--bg)_25%,transparent)]'
              : 'bg-[color-mix(in_oklab,var(--fg)_10%,transparent)]',
          )}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

/* ─────────────────────── Utils ─────────────────────── */

function shortAddr(a: string | null): string {
  if (!a) return '—';
  if (a.length <= 12) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

const STATUS_TONE: Record<IntentStatus, string> = {
  pending:
    'border border-[color-mix(in_oklab,var(--accent)_50%,var(--border))] text-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]',
  signed:
    'border border-[var(--border)] text-[var(--fg-2)] bg-[color-mix(in_oklab,var(--fg)_4%,transparent)]',
  executed:
    'border border-[color-mix(in_oklab,var(--up)_45%,var(--border))] text-[var(--up)] bg-[color-mix(in_oklab,var(--up)_10%,transparent)]',
  failed:
    'border border-[color-mix(in_oklab,var(--down)_45%,var(--border))] text-[var(--down)] bg-[color-mix(in_oklab,var(--down)_10%,transparent)]',
  expired:
    'border border-[var(--border)] text-[var(--fg-3)] bg-transparent',
};
