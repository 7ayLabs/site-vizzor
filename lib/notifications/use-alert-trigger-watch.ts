'use client';

/**
 * useAlertTriggerWatch — polls /api/alerts and mints a notification
 * every time a NEW row appears in the `triggered` bucket that we
 * haven't already surfaced.
 *
 * Why site-side detection: alerts live in the Vizzor engine and are
 * fired by the engine's alert-rule-engine. The Telegram bot picks
 * up triggers via a DM; the web UI didn't have an equivalent
 * signal until now — a triggered alert just showed up in the
 * `triggered` bucket of the modal list, with no push, no badge, no
 * chat message. This hook closes that gap: any /app/* surface that
 * mounts it converts an engine-side trigger into a notification row
 * the user sees on the sidebar badge + a Vizzor chat message on
 * their next /predict visit.
 *
 * Dedupe strategy:
 *   - Seen-set is keyed on the alert row's `id` and persisted in
 *     localStorage per wallet (`vz.alertsSeen:<walletShort>`).
 *   - The seen-set is only pruned when a wallet disconnects — we
 *     want to keep old ids so a re-fired alert isn't double-emitted
 *     across sessions.
 *   - The server also dedupes on (wallet, kind, ref_id) within 60s
 *     so a rare race between two tabs is idempotent.
 */

import { useEffect, useRef } from 'react';
import useSWR from 'swr';

interface AlertRow {
  id?: string;
  symbol?: string;
  direction?: string;
  price?: number;
}

interface AlertsResponse {
  ok?: boolean;
  alerts?: {
    triggered?: AlertRow[];
  };
}

const ALERTS_KEY = '/api/alerts';
const POLL_MS = 30_000;

function seenKey(wallet: string): string {
  const short = wallet.length > 12
    ? `${wallet.slice(0, 6)}${wallet.slice(-4)}`
    : wallet;
  return `vz.alertsSeen:${short}`;
}

function readSeen(wallet: string | undefined): Set<string> {
  if (!wallet) return new Set();
  try {
    const raw = window.localStorage.getItem(seenKey(wallet));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((x): x is string => typeof x === 'string'));
    }
  } catch {
    /* localStorage blocked / corrupt — fall through to empty set */
  }
  return new Set();
}

function persistSeen(wallet: string | undefined, seen: Set<string>): void {
  if (!wallet) return;
  try {
    // Cap at 500 ids so a wallet with many triggers over time doesn't
    // blow past the localStorage quota. Keep the most recent by
    // dropping the head of the set (insertion order).
    const arr = Array.from(seen);
    const capped = arr.length > 500 ? arr.slice(arr.length - 500) : arr;
    window.localStorage.setItem(seenKey(wallet), JSON.stringify(capped));
  } catch {
    /* silent — dropping a persist is OK, the seen-set stays in RAM */
  }
}

const fetcher = async (url: string): Promise<AlertsResponse> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 401) return {};
  return (await res.json()) as AlertsResponse;
};

export function useAlertTriggerWatch(opts: {
  enabled: boolean;
  wallet: string | undefined;
  onNewTrigger?: () => void;
}): void {
  const { enabled, wallet, onNewTrigger } = opts;
  const seenRef = useRef<Set<string> | null>(null);
  const primedRef = useRef(false);

  // Hydrate the seen-set from localStorage once per wallet change.
  useEffect(() => {
    if (!enabled) return;
    seenRef.current = readSeen(wallet);
    // First mount: don't emit for anything already in `triggered` at
    // hydration time. That prevents a re-render/reload from firing
    // notifications for every historical trigger. We mark ALL current
    // triggers as seen on the first payload, then only emit on genuine
    // new arrivals after that.
    primedRef.current = false;
  }, [wallet, enabled]);

  const { data } = useSWR<AlertsResponse>(
    enabled ? ALERTS_KEY : null,
    fetcher,
    {
      refreshInterval: POLL_MS,
      revalidateOnFocus: true,
      dedupingInterval: 10_000,
      shouldRetryOnError: false,
    },
  );

  useEffect(() => {
    if (!enabled || !data?.alerts) return;
    const seen = seenRef.current;
    if (!seen) return;

    const triggered = (data.alerts.triggered ?? []).filter(
      (r): r is AlertRow & { id: string } => typeof r.id === 'string',
    );
    if (triggered.length === 0) {
      if (!primedRef.current) primedRef.current = true;
      return;
    }

    if (!primedRef.current) {
      // Prime: seed the seen-set with everything currently triggered,
      // don't emit. Any new id after this baseline fires a
      // notification.
      for (const r of triggered) seen.add(r.id);
      persistSeen(wallet, seen);
      primedRef.current = true;
      return;
    }

    const fresh = triggered.filter((r) => !seen.has(r.id));
    if (fresh.length === 0) return;

    // Emit one notification per newly-triggered alert. The server
    // dedupes on (wallet, kind, ref_id) within 60s so a tab race is
    // idempotent. We add every id to the seen-set eagerly so a POST
    // failure doesn't cause an emit storm on the next poll.
    for (const r of fresh) seen.add(r.id);
    persistSeen(wallet, seen);

    let emittedAny = false;
    for (const r of fresh) {
      const symbol = (r.symbol ?? '').toUpperCase();
      if (!/^[A-Z0-9]{1,16}$/.test(symbol)) continue;
      void fetch('/api/notifications/emit', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'alert_triggered',
          ref_id: r.id,
          level: 'info',
          symbol,
        }),
      }).catch(() => {
        /* silent — notification emit is best-effort */
      });
      emittedAny = true;
    }
    if (emittedAny && onNewTrigger) onNewTrigger();
  }, [data, enabled, wallet, onNewTrigger]);
}
