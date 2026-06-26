'use client';

/**
 * AlertsList — wallet-scoped armed / triggered / resolved alerts.
 *
 * Fetches /api/alerts (SIWS-gated, wallet-scoped server-side) every
 * 30s. Three section blocks: Armed (active triggers), Triggered (last
 * 24h that fired), Resolved (last 7d that closed).
 *
 * Visual chrome matches the hero data cards and how-it-works cards:
 * corner brackets via `vt-bracket`, hairline `--border`, mono tabular
 * numbers, monochrome with only the scoped `--up`/`--down` direction
 * tokens on actual chevrons.
 *
 * When the engine is unreachable the API returns `_stale: true` and
 * we render a small mono pill on each section header so the user
 * knows the data is snapshot-cached. Visitors NEVER see broken
 * numbers — the empty-state always renders even if upstream is down.
 */

import { useCallback, useMemo, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Bell, ChevronDown, ChevronUp, ExternalLink, Plus, X } from 'lucide-react';
import { CoinIcon } from '@/components/ui/coin-icon';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { useTicker } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AlertKind, AlertRow, Direction } from '@/lib/types';

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
  if (res.status === 401) {
    return { ok: false, reason: 'unauthenticated' };
  }
  if (res.status === 402) {
    return { ok: false, reason: 'tier_required' };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<AlertsResponse>;
};

export function AlertsList() {
  const t = useTranslations('app.alerts');
  const { mutate } = useSWRConfig();
  const { data, error, isLoading } = useSWR<AlertsResponse>(
    '/api/alerts',
    fetcher,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
      shouldRetryOnError: false,
    },
  );

  // Live ticker — used by armed rows to compute unrealized P/L% against
  // the parent trade plan's entry. Triggered/resolved rows pivot on
  // `triggeredPrice` from the engine so we don't need the live ticker
  // for those; but a single shared subscription is cheaper than
  // re-mounting in the row component.
  const { data: ticker } = useTicker();
  const priceBySymbol = useMemo(() => {
    const map = new Map<string, number>();
    (ticker ?? []).forEach((t) => {
      map.set(t.symbol.toUpperCase(), t.price);
    });
    return map;
  }, [ticker]);

  const refresh = useCallback(() => {
    void mutate('/api/alerts');
  }, [mutate]);

  const onCancel = useCallback(
    async (id: string): Promise<void> => {
      try {
        const res = await fetch(`/api/alerts/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (res.ok) {
          toast.success(t('cancel.success'));
          refresh();
          return;
        }
        const reason =
          res.status === 503
            ? t('cancel.engineUnavailable')
            : res.status === 404
              ? t('cancel.notFound')
              : t('cancel.error');
        toast.error(reason);
      } catch {
        toast.error(t('cancel.error'));
      }
    },
    [refresh, t],
  );

  if (isLoading && !data) {
    return (
      <p className="text-[13px] text-[var(--fg-3)]">{t('loading')}</p>
    );
  }

  if (data && !data.ok && data.reason === 'unauthenticated') {
    return <EmptyState variant="signed-out" />;
  }
  if (data && !data.ok && data.reason === 'tier_required') {
    return <EmptyState variant="tier" />;
  }
  if (error || !data?.alerts) {
    return <EmptyState variant="error" />;
  }

  const { armed, triggered, resolved } = data.alerts;

  return (
    <div className="flex flex-col gap-5">
      <ArmAlertForm onArmed={refresh} />
      <AlertSection
        title={t('sections.armed.title')}
        empty={t('sections.armed.empty')}
        rows={armed}
        priceBySymbol={priceBySymbol}
        onCancel={onCancel}
      />
      <AlertSection
        title={t('sections.triggered.title')}
        empty={t('sections.triggered.empty')}
        rows={triggered}
        priceBySymbol={priceBySymbol}
      />
      <AlertSection
        title={t('sections.resolved.title')}
        empty={t('sections.resolved.empty')}
        rows={resolved}
        priceBySymbol={priceBySymbol}
      />
    </div>
  );
}

/* ─────────────────────── section ─────────────────────── */

function AlertSection({
  title,
  empty,
  rows,
  priceBySymbol,
  onCancel,
}: {
  title: string;
  empty: string;
  rows: readonly AlertRow[];
  /** Live ticker prices keyed by uppercase symbol. Used by armed rows
   *  to render unrealized P/L%; absent for sections that pivot on
   *  `triggeredPrice` (still passed so the prop shape stays uniform). */
  priceBySymbol: ReadonlyMap<string, number>;
  /** When wired, each row gets a cancel affordance — used for the
   *  Armed section only (cancelling a triggered/resolved alert is a
   *  no-op in the engine). */
  onCancel?: (id: string) => void | Promise<void>;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between gap-3 px-0.5">
        <h2 className="text-[14px] leading-[1.2] tracking-[-0.012em] font-semibold text-[var(--fg)]">
          {title}
        </h2>
        <span className="mono tabular text-[10px] text-[var(--fg-3)]">
          {rows.length}
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="text-[12.5px] text-[var(--fg-3)] px-0.5">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)]/60">
          {rows.map((alert) => (
            <AlertRowItem
              key={alert.id}
              alert={alert}
              livePrice={priceBySymbol.get(alert.symbol)}
              onCancel={onCancel}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ─────────────────────── row ─────────────────────── */

function AlertRowItem({
  alert,
  livePrice,
  onCancel,
}: {
  alert: AlertRow;
  /** Live ticker price for this symbol, when available. */
  livePrice?: number;
  onCancel?: (id: string) => void | Promise<void>;
}) {
  const t = useTranslations('app.alerts.row');
  const up = alert.direction === 'up';
  const directionColor = up ? 'var(--up)' : 'var(--down)';
  const kindLabel = alert.kind.toUpperCase();
  const isArmed = alert.status === 'armed';

  // Pick the timestamp most relevant for the status the row is in.
  const ts =
    alert.status === 'resolved'
      ? alert.resolvedAt ?? alert.triggeredAt
      : alert.status === 'triggered'
        ? alert.triggeredAt
        : alert.armedAt;

  // Reference price for P/L%: live ticker for armed rows, triggered
  // price for fired rows (engine-authoritative spot at fire time).
  const referencePrice = isArmed ? livePrice : alert.triggeredPrice ?? livePrice;
  const pnlPct = computePnlPct({
    entryPrice: alert.entryPrice,
    referencePrice,
    tradeDirection: alert.tradeDirection,
    leverage: alert.leverage,
  });

  return (
    <li className="flex items-center gap-2.5 px-1 py-2.5">
      <CoinIcon symbol={alert.symbol} size={18} />
      <div className="flex flex-col gap-0.5 min-w-[64px]">
        <span className="mono tabular text-[12px] font-semibold text-[var(--fg)] inline-flex items-center gap-1.5">
          {alert.symbol}
          {isArmed && (
            <span
              className={cn(
                'inline-flex items-center gap-1 mono tabular',
                'text-[8.5px] font-semibold uppercase tracking-[0.16em]',
                'text-[var(--up)]',
              )}
              aria-label={t('live')}
            >
              <span
                aria-hidden
                className="inline-block h-1 w-1 rounded-full bg-[var(--up)] motion-safe:animate-pulse"
              />
              {t('live')}
            </span>
          )}
        </span>
        <span
          className="mono tabular text-[9.5px] uppercase tracking-[0.14em] text-[var(--fg-3)]"
          aria-label="trigger kind"
        >
          {kindLabel}
          {alert.leverage ? (
            <>
              <span aria-hidden className="mx-1 text-[var(--fg-3)]/60">·</span>
              <span className="text-[var(--fg-2)]">{t('leverage', { x: alert.leverage })}</span>
            </>
          ) : null}
        </span>
      </div>
      <div className="flex flex-col gap-0.5 ml-1">
        <span
          className="mono tabular text-[11.5px] inline-flex items-center gap-0.5"
          style={{ color: directionColor }}
          aria-label={`${alert.direction} trigger`}
        >
          <span aria-hidden>{up ? '▲' : '▼'}</span>
          <AnimatedNumber value={alert.price} format="usd" duration={700} />
        </span>
        {alert.entryPrice ? (
          <span className="mono tabular text-[9.5px] text-[var(--fg-3)] uppercase tracking-[0.12em]">
            {t('entry')} ${formatPrice(alert.entryPrice)}
          </span>
        ) : null}
      </div>
      <span className="flex-1" aria-hidden />
      <div className="flex flex-col items-end gap-0.5">
        {pnlPct !== null ? (
          <span
            className={cn(
              'mono tabular text-[11px] font-semibold tracking-tight',
              pnlPct >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]',
            )}
            aria-label="profit and loss"
          >
            {pnlPct >= 0 ? '+' : '−'}
            {Math.abs(pnlPct).toFixed(2)}%
          </span>
        ) : null}
        <span className="mono tabular text-[9.5px] text-[var(--fg-3)]">
          {ts ? relativeTime(ts) : '—'}
        </span>
      </div>
      {onCancel && isArmed && (
        <CancelButton id={alert.id} onCancel={onCancel} />
      )}
    </li>
  );
}

/**
 * Compute the leveraged P/L% of an alert row.
 *
 *   - Requires `entryPrice` (from the parent trade plan) + a reference
 *     price (live ticker for armed, triggered price for fired rows).
 *   - Direction-aware: long plans profit when price > entry, short
 *     plans profit when price < entry. The sign of the % reflects
 *     trade outcome, not raw price delta.
 *   - Leverage scales the % linearly (3x leverage on +1% price → +3%
 *     position). Defaults to 1x when not provided.
 *
 * Returns null when any input is missing or invalid — caller hides
 * the cell entirely rather than rendering `NaN%` or a misleading 0%.
 */
function computePnlPct({
  entryPrice,
  referencePrice,
  tradeDirection,
  leverage,
}: {
  entryPrice?: number;
  referencePrice?: number;
  tradeDirection?: 'long' | 'short';
  leverage?: number;
}): number | null {
  if (!entryPrice || !referencePrice) return null;
  if (entryPrice <= 0 || referencePrice <= 0) return null;
  const rawDelta = (referencePrice - entryPrice) / entryPrice;
  const signed = tradeDirection === 'short' ? -rawDelta : rawDelta;
  const lev = leverage && leverage > 0 ? leverage : 1;
  const pct = signed * lev * 100;
  if (!Number.isFinite(pct)) return null;
  return pct;
}

function formatPrice(n: number): string {
  if (n < 1) return n.toFixed(4);
  if (n < 100) return n.toFixed(2);
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function CancelButton({
  id,
  onCancel,
}: {
  id: string;
  onCancel: (id: string) => void | Promise<void>;
}) {
  const t = useTranslations('app.alerts');
  const [busy, setBusy] = useState(false);
  const handle = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await onCancel(id);
    } finally {
      setBusy(false);
    }
  }, [busy, id, onCancel]);
  return (
    <button
      type="button"
      onClick={() => void handle()}
      disabled={busy}
      aria-label={t('cancel.label')}
      title={t('cancel.label')}
      className={cn(
        'inline-flex items-center justify-center h-7 w-7 rounded-md',
        'text-[var(--fg-3)] hover:text-[var(--danger)]',
        'hover:bg-[var(--surface-2)] transition-colors',
        'disabled:opacity-50 disabled:pointer-events-none',
      )}
    >
      <X size={14} aria-hidden />
    </button>
  );
}

/* ─────────────────────── empty states ─────────────────────── */

type EmptyVariant = 'signed-out' | 'tier' | 'none' | 'error';

function EmptyState({
  variant,
  stale,
}: {
  variant: EmptyVariant;
  stale?: boolean;
}) {
  const t = useTranslations('app.alerts.empty');

  const titleKey =
    variant === 'signed-out'
      ? 'signedOut.title'
      : variant === 'tier'
        ? 'tier.title'
        : variant === 'error'
          ? 'error.title'
          : 'none.title';
  const bodyKey =
    variant === 'signed-out'
      ? 'signedOut.body'
      : variant === 'tier'
        ? 'tier.body'
        : variant === 'error'
          ? 'error.body'
          : 'none.body';

  return (
    <div className="rounded-xl border border-[var(--border)]/70 bg-[color-mix(in_oklab,var(--surface)_60%,transparent)] px-8 py-10 flex flex-col items-center text-center gap-4">
      <Bell
        size={32}
        strokeWidth={1.25}
        className="text-[var(--fg-3)]"
        aria-hidden
      />
      <div className="flex flex-col gap-2 max-w-[42ch]">
        <h2 className="text-[17px] leading-[1.2] tracking-[-0.014em] font-semibold text-[var(--fg)]">
          {t(titleKey)}
        </h2>
        <p className="text-[13.5px] leading-relaxed text-[var(--fg-2)]">
          {t(bodyKey)}
        </p>
      </div>
      {variant === 'none' && (
        <a
          href="https://t.me/vizzorai_bot"
          target="_blank"
          rel="noopener noreferrer"
          className="
            mt-2 inline-flex items-center gap-1.5 h-9 px-4 rounded-full
            text-[12.5px] font-semibold tracking-tight
            bg-[#229ED9] hover:bg-[#1B8FC4] text-white
            transition-colors
          "
        >
          <span>{t('none.cta')}</span>
          <ExternalLink size={12} strokeWidth={2.25} />
        </a>
      )}
      {stale && (
        <p className="mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--fg-3)] mt-2">
          {t('staleHint')}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────── arm form ─────────────────────── */

const SYMBOLS: readonly string[] = ['BTC', 'ETH', 'SOL', 'TON'];
const KINDS: readonly AlertKind[] = ['entry', 'tp1', 'tp2', 'sl', 'custom'];

/**
 * ArmAlertForm — inline form to arm a new price-trigger alert.
 *
 * Submits to POST /api/alerts which proxies the engine. On success
 * the SWR cache is invalidated via `onArmed` so the new row appears
 * in the Armed section immediately. The form is intentionally a
 * single compact card — no multi-step wizard — because users who
 * arm an alert already know the four inputs (symbol, kind, direction,
 * price); a wizard would add friction without value.
 */
function ArmAlertForm({ onArmed }: { onArmed: () => void }) {
  const t = useTranslations('app.alerts.arm');
  const [symbol, setSymbol] = useState<string>(SYMBOLS[0] ?? 'BTC');
  const [kind, setKind] = useState<AlertKind>('custom');
  const [direction, setDirection] = useState<Direction>('up');
  const [price, setPrice] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (e: React.FormEvent): Promise<void> => {
      e.preventDefault();
      const parsed = Number.parseFloat(price);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        toast.error(t('errors.price'));
        return;
      }
      setBusy(true);
      try {
        const res = await fetch('/api/alerts', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            symbol,
            kind,
            direction,
            price: parsed,
          }),
        });
        if (res.ok) {
          toast.success(t('success'));
          setPrice('');
          onArmed();
          return;
        }
        const reason =
          res.status === 503
            ? t('errors.engineUnavailable')
            : res.status === 401
              ? t('errors.unauthenticated')
              : res.status === 400
                ? t('errors.invalid')
                : t('errors.generic');
        toast.error(reason);
      } catch {
        toast.error(t('errors.engineUnavailable'));
      } finally {
        setBusy(false);
      }
    },
    [direction, kind, onArmed, price, symbol, t],
  );

  return (
    <form
      onSubmit={submit}
      className={cn(
        'rounded-xl border border-[var(--border)]/70',
        'bg-[color-mix(in_oklab,var(--surface)_60%,transparent)]',
        'p-3.5 sm:p-4',
        'flex flex-col gap-3',
      )}
    >
      <h3 className="text-[13.5px] font-semibold tracking-tight text-[var(--fg)] px-0.5">
        {t('title')}
      </h3>

      <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_auto_1fr_auto] gap-2 items-end">
        {/* Symbol */}
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-medium tracking-tight text-[var(--fg-3)]">
            {t('symbol')}
          </span>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className={cn(
              'h-9 px-2 rounded-md border border-[var(--border)] bg-transparent',
              'mono tabular text-[12.5px] text-[var(--fg)]',
              'focus:outline-none focus:border-[var(--border-hi)]',
            )}
          >
            {SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        {/* Kind */}
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-medium tracking-tight text-[var(--fg-3)]">
            {t('kind')}
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AlertKind)}
            className={cn(
              'h-9 px-2 rounded-md border border-[var(--border)] bg-transparent',
              'mono tabular text-[12.5px] uppercase text-[var(--fg)]',
              'focus:outline-none focus:border-[var(--border-hi)]',
            )}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k.toUpperCase()}
              </option>
            ))}
          </select>
        </label>

        {/* Direction toggle */}
        <div
          role="radiogroup"
          aria-label={t('direction')}
          className="flex flex-col gap-1"
        >
          <span className="text-[10.5px] font-medium tracking-tight text-[var(--fg-3)]">
            {t('direction')}
          </span>
          <div className="inline-flex h-9 rounded-md border border-[var(--border)] overflow-hidden">
            <button
              type="button"
              role="radio"
              aria-checked={direction === 'up'}
              onClick={() => setDirection('up')}
              className={cn(
                'inline-flex items-center justify-center w-9',
                direction === 'up'
                  ? 'bg-[var(--fg)] text-[var(--bg)]'
                  : 'text-[var(--fg-3)] hover:text-[var(--fg)]',
              )}
              title={t('up')}
            >
              <ChevronUp size={14} aria-hidden />
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={direction === 'down'}
              onClick={() => setDirection('down')}
              className={cn(
                'inline-flex items-center justify-center w-9 border-l border-[var(--border)]',
                direction === 'down'
                  ? 'bg-[var(--fg)] text-[var(--bg)]'
                  : 'text-[var(--fg-3)] hover:text-[var(--fg)]',
              )}
              title={t('down')}
            >
              <ChevronDown size={14} aria-hidden />
            </button>
          </div>
        </div>

        {/* Price */}
        <label className="flex flex-col gap-1 col-span-2 sm:col-span-1">
          <span className="text-[10.5px] font-medium tracking-tight text-[var(--fg-3)]">
            {t('price')}
          </span>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
            className={cn(
              'h-9 px-2 rounded-md border border-[var(--border)] bg-transparent',
              'mono tabular text-[12.5px] text-[var(--fg)]',
              'focus:outline-none focus:border-[var(--border-hi)]',
            )}
          />
        </label>

        {/* Submit */}
        <button
          type="submit"
          disabled={busy || !price}
          className={cn(
            'h-9 px-3 rounded-md inline-flex items-center justify-center gap-1.5',
            'bg-[var(--fg)] text-[var(--bg)]',
            'text-[12px] font-semibold tracking-tight',
            'hover:opacity-90 transition-opacity',
            'disabled:opacity-40 disabled:pointer-events-none',
            'col-span-2 sm:col-span-1',
          )}
        >
          <Plus size={14} aria-hidden />
          {busy ? t('arming') : t('arm')}
        </button>
      </div>
    </form>
  );
}

/* ─────────────────────── helpers ─────────────────────── */

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const deltaMs = Date.now() - then;
  if (deltaMs < 0) return 'now';
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
