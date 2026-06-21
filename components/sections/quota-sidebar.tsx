'use client';

/**
 * QuotaSidebar — free-tier counter + paywall / subscribed states.
 *
 * Terminal aesthetic refactor (Phase 2B):
 *
 *   - Wrapped in a `<DataTile variant="terminal" live>`-style card with
 *     accent corner brackets, hairline `--border-hi` border, pulsing
 *     live dot.
 *   - Mono fraction value (`used / limit`) replaces the existing 36px
 *     numeral block.
 *   - Limit-sized progress dot row (▀ filled vs ░ empty) replaces the
 *     3-column hairline grid.
 *   - "SUBSCRIBED" mono badge surfaces when the visitor is signed in
 *     with an active subscription, since `/api/quota` already returns
 *     the flag.
 *
 * SWR wiring (`/api/quota` + dev `/api/quota/reset`) is untouched —
 * cache key, fetcher, refreshKey behavior are byte-identical to the
 * previous implementation. Visual only.
 */

import useSWR from 'swr';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

const IS_DEV = process.env.NODE_ENV !== 'production';

interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
  subscribed?: boolean;
  subscription?: {
    tier: string;
    cadence: string;
    expiresAt: string;
  } | null;
}

const fetcher = (url: string): Promise<QuotaState> =>
  fetch(url).then((r) => r.json() as Promise<QuotaState>);

export interface QuotaSidebarProps {
  refreshKey?: number;
}

export function QuotaSidebar({ refreshKey = 0 }: QuotaSidebarProps) {
  const t = useTranslations('predict');
  const { data, mutate } = useSWR<QuotaState>('/api/quota', fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  useEffect(() => {
    if (refreshKey > 0) void mutate();
  }, [refreshKey, mutate]);

  if (!data) {
    return (
      <TerminalCard live={false}>
        <p className="mono tabular text-[10.5px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
          {t('loading')}
        </p>
      </TerminalCard>
    );
  }

  const onReset = async (): Promise<void> => {
    const res = await fetch('/api/quota/reset', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!res.ok) return;
    window.location.reload();
  };

  const body = data.exhausted ? (
    <SubscribePanel />
  ) : (
    <FreeCounterPanel
      used={data.used}
      limit={data.limit}
      remaining={data.remaining}
      subscribed={!!data.subscribed}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      {body}
      {IS_DEV && <ResetLink onReset={onReset} />}
    </div>
  );
}

/* ────────────── shared terminal card ────────────── */

function TerminalCard({
  children,
  live,
}: {
  children: React.ReactNode;
  live: boolean;
}) {
  return (
    <div
      className={cn(
        'vt-bracket relative flex flex-col gap-3',
        'rounded-lg bg-[var(--surface)]',
        'border border-[var(--border-hi)]',
        'p-5',
      )}
    >
      {live && (
        <span
          aria-hidden
          className="absolute right-3 top-3 inline-block h-1.5 w-1.5 rounded-full"
          style={{
            background: 'var(--accent)',
            animation: 'pulse-dot 1.6s ease-in-out infinite',
          }}
        />
      )}
      {children}
    </div>
  );
}

/* ────────────── reset link (dev only) ────────────── */

function ResetLink({ onReset }: { onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      className="
        self-start mono tabular text-[10px] uppercase tracking-[0.16em]
        text-[var(--fg-3)] hover:text-[var(--fg-2)] underline-offset-4
        hover:underline transition-colors
      "
    >
      reset quota · dev only
    </button>
  );
}

/* ────────────── free-tier panel ────────────── */

function FreeCounterPanel({
  used,
  limit,
  remaining,
  subscribed,
}: {
  used: number;
  limit: number;
  remaining: number;
  subscribed: boolean;
}) {
  const t = useTranslations('predict');

  return (
    <TerminalCard live>
      <div className="flex items-start justify-between gap-2">
        <p className="mono tabular text-[10.5px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
          {t('freeTier.label')}
        </p>
        {subscribed && <SubscribedBadge />}
      </div>

      {/* Mono fraction: remaining / limit */}
      <div className="flex items-baseline gap-1">
        <span className="mono tabular text-[26px] leading-none font-semibold text-[var(--fg)]">
          {remaining}
        </span>
        <span className="mono tabular text-[14px] leading-none text-[var(--fg-3)]">
          /
        </span>
        <span className="mono tabular text-[14px] leading-none text-[var(--fg-3)]">
          {limit}
        </span>
      </div>

      {/* Progress dot row — ▀▀ filled (used) vs ░░ empty (remaining). */}
      <ProgressDotRow used={used} limit={limit} />

      <p className="text-[12px] leading-relaxed text-[var(--fg-2)]">
        {t('freeTier.body', { used, limit })}
      </p>
    </TerminalCard>
  );
}

/* ────────────── subscribed badge ────────────── */

function SubscribedBadge() {
  const t = useTranslations('predict.shell');
  return (
    <span
      className={cn(
        'mono tabular text-[9.5px] uppercase tracking-[0.18em] font-semibold leading-none',
        'inline-flex items-center gap-1.5',
        'border border-[var(--gold)] text-[var(--gold)]',
        'px-1.5 py-1 rounded',
      )}
    >
      <span
        aria-hidden
        className="inline-block h-1 w-1 rounded-full"
        style={{ background: 'var(--gold)' }}
      />
      {t('subscribed')}
    </span>
  );
}

/* ────────────── progress dot row ────────────── */

function ProgressDotRow({ used, limit }: { used: number; limit: number }) {
  const cells = Array.from({ length: Math.max(0, limit) }, (_, i) => i < used);
  return (
    <div
      className="mono tabular text-[14px] leading-none tracking-[0.08em] select-none"
      aria-hidden
    >
      {cells.map((filled, i) => (
        <span
          key={i}
          className={cn(
            'inline-block',
            filled ? 'text-[var(--fg-3)]/55' : 'text-[var(--accent)]',
          )}
        >
          {filled ? '▀' : '░'}
        </span>
      ))}
    </div>
  );
}

/* ────────────── subscribe panel (exhausted) ────────────── */

function SubscribePanel() {
  const t = useTranslations('predict');

  return (
    <TerminalCard live={false}>
      <p className="mono tabular text-[10.5px] uppercase tracking-[0.16em] text-[var(--accent)]">
        {t('subscribe.label')}
      </p>

      <h3 className="text-[15px] font-semibold tracking-tight text-[var(--fg)]">
        {t('subscribe.title')}
      </h3>

      <p className="text-[12.5px] leading-relaxed text-[var(--fg-2)]">
        {t('subscribe.body')}
      </p>

      <Link
        href="/pricing"
        className="
          mt-1 inline-flex items-center justify-center
          mono tabular text-[10.5px] uppercase tracking-[0.16em]
          border border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]
          px-3 py-2 hover:opacity-90 transition-opacity
          rounded
        "
      >
        {t('subscribe.cta')}
      </Link>

      <p className="mono tabular text-[9.5px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
        {t('subscribe.legal')}
      </p>
    </TerminalCard>
  );
}
