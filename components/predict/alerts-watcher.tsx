'use client';

/**
 * AlertsWatcher — invisible client component that mounts once at the
 * predict shell root and watches the wallet's alerts feed.
 *
 * Behaviour:
 *   - Polls /api/alerts every 30s through the same SWR cache the
 *     AlertsList + AlertsModal share, so a single network call
 *     drives every alerts surface in the shell.
 *   - Diffs the `triggered` bucket between consecutive snapshots.
 *     Any id that appears NEW in the current snapshot (and wasn't in
 *     the previous one) is treated as a fresh fire and surfaced as:
 *       1. A sonner toast banner pinned to the top of the shell.
 *       2. A native browser Notification (only when the user has
 *          already granted permission — the modal handles the prompt).
 *   - The seed snapshot is captured silently so we don't toast the
 *     entire backlog on first mount.
 *
 * No UI; this component renders `null`.
 */

import { useEffect, useRef } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { AlertRow } from '@/lib/types';

interface AlertsResponse {
  ok: boolean;
  alerts?: {
    armed: AlertRow[];
    triggered: AlertRow[];
    resolved: AlertRow[];
    cancelled: AlertRow[];
  };
  _stale?: boolean;
  reason?: string;
}

const fetcher = async (url: string): Promise<AlertsResponse> => {
  const res = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (res.status === 401 || res.status === 402 || !res.ok) {
    return { ok: false };
  }
  return res.json() as Promise<AlertsResponse>;
};

export function AlertsWatcher({ enabled }: { enabled: boolean }) {
  const t = useTranslations('app.alerts.banner');
  const { data } = useSWR<AlertsResponse>(
    enabled ? '/api/alerts' : null,
    fetcher,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
      shouldRetryOnError: false,
    },
  );

  // Track ids we've already announced so a row that lingers in the
  // `triggered` bucket across polls doesn't re-toast every 30s. We
  // also seed the set on the very first payload so the historical
  // backlog stays silent.
  const seenRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!data?.ok || !data.alerts) return;
    const triggered = data.alerts.triggered ?? [];

    if (seenRef.current === null) {
      // First snapshot — silently record everything currently in the
      // triggered bucket so future polls only surface NEW fires.
      seenRef.current = new Set(triggered.map((a) => a.id));
      return;
    }

    const seen = seenRef.current;
    const fresh = triggered.filter((a) => !seen.has(a.id));
    if (fresh.length === 0) return;
    for (const alert of fresh) {
      seen.add(alert.id);
      const direction = alert.direction === 'up' ? '▲' : '▼';
      const titleText = t('title', {
        symbol: alert.symbol,
        kind: alert.kind.toUpperCase(),
      });
      const bodyText = t('body', {
        direction,
        price: alert.price,
      });

      // In-page banner via sonner. Long duration so users scanning
      // the chat don't miss it.
      toast(titleText, {
        description: bodyText,
        duration: 10_000,
      });

      // Native desktop notification — only fires when permission was
      // already granted (the modal asks for it on open). Browsers
      // never surface a "request" through this path.
      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        try {
          new Notification(titleText, {
            body: bodyText,
            tag: `vz-alert-${alert.id}`,
            icon: '/icons/icon-192.png',
          });
        } catch {
          // Some browsers throw when called outside a user gesture
          // even with permission granted (Safari). The sonner banner
          // is the resilient fallback so the user still sees it.
        }
      }
    }
  }, [enabled, data, t]);

  return null;
}
