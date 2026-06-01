'use client';

/**
 * QuotaSidebar — free-tier counter + paywall state.
 *
 * Polls `/api/quota` via SWR to stay in sync after each prediction.
 * Three visual states:
 *   1. Free tier active   — shows "Free: N/limit" counter
 *   2. Free exhausted, token NOT live — "$VIZZOR launching soon" panel
 *   3. Free exhausted, token live — "Connect wallet → burn N $VIZZOR"
 *      (Phase 2 wires the actual wallet adapter; for Phase 1 this case
 *      is unreachable because isLive defaults to false.)
 */

import useSWR from 'swr';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
  isLive: boolean;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface QuotaSidebarProps {
  refreshKey?: number;
}

export function QuotaSidebar({ refreshKey = 0 }: QuotaSidebarProps) {
  const t = useTranslations('predict');
  const { data, mutate } = useSWR<QuotaState>('/api/quota', fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  // Refetch quota whenever the parent signals a chat finish.
  useEffect(() => {
    if (refreshKey > 0) void mutate();
  }, [refreshKey, mutate]);

  if (!data) {
    return (
      <div className="border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="mono tabular text-[10.5px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
          {t('loading')}
        </p>
      </div>
    );
  }

  if (data.exhausted) {
    return data.isLive ? <PaidConnectPanel /> : <WaitlistPanel />;
  }

  return <FreeCounterPanel used={data.used} limit={data.limit} remaining={data.remaining} />;
}

function FreeCounterPanel({
  used,
  limit,
  remaining,
}: {
  used: number;
  limit: number;
  remaining: number;
}) {
  const t = useTranslations('predict');

  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col gap-4">
      <p className="mono tabular text-[10.5px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
        {t('freeTier.label')}
      </p>

      <div className="flex items-baseline gap-2">
        <span className="display text-[36px] leading-none font-semibold text-[var(--fg)] mono tabular">
          {remaining}
        </span>
        <span className="mono tabular text-[12px] text-[var(--fg-3)]">
          / {limit}
        </span>
      </div>

      <p className="text-[12.5px] leading-relaxed text-[var(--fg-2)]">
        {t('freeTier.body', { used, limit })}
      </p>

      <div className="mt-1 grid grid-cols-3 gap-1.5" aria-hidden>
        {Array.from({ length: limit }, (_, i) => (
          <div
            key={i}
            className="h-1.5"
            style={{
              background:
                i < used ? 'var(--fg-3)' : 'var(--accent)',
              opacity: i < used ? 0.3 : 1,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function WaitlistPanel() {
  const t = useTranslations('predict');

  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col gap-3">
      <p className="mono tabular text-[10.5px] uppercase tracking-[0.16em] text-[var(--accent)]">
        {t('waitlist.label')}
      </p>
      <h3 className="text-[16px] font-semibold tracking-tight text-[var(--fg)]">
        {t('waitlist.title')}
      </h3>
      <p className="text-[12.5px] leading-relaxed text-[var(--fg-2)]">
        {t('waitlist.body')}
      </p>
      <a
        href="https://t.me/vizzorai_bot"
        target="_blank"
        rel="noopener"
        className="
          mt-2 inline-flex items-center justify-center
          mono tabular text-[10.5px] uppercase tracking-[0.16em]
          border border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]
          px-3 py-2 hover:opacity-90 transition-opacity
        "
      >
        {t('waitlist.cta')}
      </a>
    </div>
  );
}

function PaidConnectPanel() {
  // Phase 2 wires the Solana wallet adapter here. For Phase 1 the
  // panel is unreachable; the placeholder copy keeps the shape stable.
  const t = useTranslations('predict');
  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="mono tabular text-[10.5px] uppercase tracking-[0.16em] text-[var(--accent)]">
        {t('paid.label')}
      </p>
      <p className="mt-2 text-[12.5px] text-[var(--fg-2)]">{t('paid.body')}</p>
    </div>
  );
}
