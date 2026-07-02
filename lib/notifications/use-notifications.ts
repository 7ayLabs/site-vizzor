'use client';

/**
 * useNotifications — shared SWR hook returning unread counts per
 * bucket (Workflows / Alerts) plus a paginated recent-items list.
 *
 * One poll per surface: the sidebar reads `.counts`, a future
 * notifications drawer reads `.items`. Polling cadence is 30s with
 * revalidate-on-focus so a user returning from another tab or from
 * a signed transaction sees the badge update without a page
 * refresh. Deduping prevents thundering herd when multiple
 * consumers on the same page mount at once.
 *
 * The hook is a no-op when `enabled` is false (unauthenticated user
 * on a public surface). No fetch fires and the fallback counts are
 * zero — safe to render everywhere without gating boilerplate.
 */

import useSWR from 'swr';

export interface NotificationItem {
  id: string;
  wallet_address: string;
  kind:
    | 'workflow_executed'
    | 'workflow_failed'
    | 'alert_triggered'
    | 'alert_resolved'
    | 'payment_due';
  ref_id: string | null;
  level: 'info' | 'success' | 'warn' | 'error';
  body: string;
  meta: Record<string, unknown> | null;
  read_at: number | null;
  created_at: number;
}

interface NotificationCounts {
  workflows: number;
  alerts: number;
  total: number;
}

interface NotificationsResponse {
  ok: boolean;
  counts?: NotificationCounts;
  items?: NotificationItem[];
  reason?: string;
}

const ZERO_COUNTS: NotificationCounts = { workflows: 0, alerts: 0, total: 0 };
const EMPTY_ITEMS: readonly NotificationItem[] = [];

const KEY = '/api/notifications';

const fetcher = async (url: string): Promise<NotificationsResponse> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 401) return { ok: false };
  return (await res.json()) as NotificationsResponse;
};

export function useNotifications(opts: { enabled: boolean } = { enabled: true }) {
  const { data, isLoading, mutate } = useSWR<NotificationsResponse>(
    opts.enabled ? KEY : null,
    fetcher,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
      dedupingInterval: 10_000,
      shouldRetryOnError: false,
    },
  );

  const counts = data?.ok ? (data.counts ?? ZERO_COUNTS) : ZERO_COUNTS;
  const items = data?.ok ? (data.items ?? EMPTY_ITEMS) : EMPTY_ITEMS;

  /**
   * Optimistically bump the unread counts without a refetch — used
   * when the shell emits a notification from an intent's terminal
   * status and wants the sidebar to reflect it immediately (30s poll
   * is too slow for that feedback loop).
   */
  const bumpCount = async (bucket: 'workflows' | 'alerts', by = 1) => {
    await mutate(
      (prev) => {
        if (!prev?.ok) return prev;
        const next: NotificationCounts = {
          workflows:
            bucket === 'workflows'
              ? (prev.counts?.workflows ?? 0) + by
              : (prev.counts?.workflows ?? 0),
          alerts:
            bucket === 'alerts'
              ? (prev.counts?.alerts ?? 0) + by
              : (prev.counts?.alerts ?? 0),
          total: (prev.counts?.total ?? 0) + by,
        };
        return { ...prev, counts: next };
      },
      { revalidate: false },
    );
  };

  const markRead = async (ids: string[]) => {
    if (ids.length === 0) return;
    await fetch(KEY, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
    }).catch(() => undefined);
    await mutate();
  };

  const markAllRead = async (bucket?: 'workflows' | 'alerts') => {
    await fetch(KEY, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bucket ? { all: true, bucket } : { all: true }),
    }).catch(() => undefined);
    await mutate();
  };

  return {
    counts,
    items,
    isLoading,
    refresh: mutate,
    bumpCount,
    markRead,
    markAllRead,
  };
}
