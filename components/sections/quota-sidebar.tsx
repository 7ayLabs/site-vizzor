'use client';

/**
 * QuotaSidebar — free-tier counter + paywall state.
 *
 * Polls `/api/quota` via SWR to stay in sync after each prediction.
 * Two visual states:
 *   1. Free tier active   — shows "Free: N/limit" counter
 *   2. Free exhausted     — routes the user to /pricing to subscribe
 */

import useSWR from 'swr';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

const IS_DEV = process.env.NODE_ENV !== 'production';

interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
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

  const onReset = async () => {
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
    />
  );

  return (
    <div className="flex flex-col gap-3">
      {body}
      {IS_DEV && <ResetLink onReset={onReset} />}
    </div>
  );
}

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
              background: i < used ? 'var(--fg-3)' : 'var(--accent)',
              opacity: i < used ? 0.3 : 1,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function SubscribePanel() {
  const t = useTranslations('predict');

  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col gap-4">
      <p className="mono tabular text-[10.5px] uppercase tracking-[0.16em] text-[var(--accent)]">
        {t('subscribe.label')}
      </p>

      <h3 className="text-[16px] font-semibold tracking-tight text-[var(--fg)]">
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
        "
      >
        {t('subscribe.cta')}
      </Link>

      <p className="mono tabular text-[9.5px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
        {t('subscribe.legal')}
      </p>
    </div>
  );
}
