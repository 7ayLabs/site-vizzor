'use client';

/**
 * QuotaSidebar — free-tier counter + paywall state.
 *
 * Polls `/api/quota` via SWR to stay in sync after each prediction.
 * Three visual states:
 *   1. Free tier active   — shows "Free: N/limit" counter
 *   2. Free exhausted, token NOT live — "$VIZZOR launching soon" panel
 *   3. Free exhausted, token live — wallet connect + burn flow
 *
 * The burn flow (state 3) is rendered by <PaidConnectPanel>, which
 * lives inside the WalletAdapter that PredictRoute mounted. We render
 * the wallet components statically here because by the time the
 * sidebar shows state 3, the wallet provider is already up the tree.
 */

import useSWR from 'swr';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { ConnectButton } from '@/components/wallet/wallet-connect';
import { BurnButton } from '@/components/wallet/burn-button';
import { burnAmount } from '@/lib/solana';

// Build-time constant. Next.js inlines `process.env.NODE_ENV` so any
// production build dead-code-eliminates the reset affordance entirely
// — it doesn't ship in the client bundle at all.
const IS_DEV = process.env.NODE_ENV !== 'production';

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
  onBurnConfirmed?: (signature: string) => void;
}

export function QuotaSidebar({
  refreshKey = 0,
  onBurnConfirmed,
}: QuotaSidebarProps) {
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

  const onReset = async () => {
    // credentials:'same-origin' is the default but stated explicitly
    // so the cookie is unambiguously sent on the response's Set-Cookie
    // hand-off path. The response body carries the fresh state, which
    // we feed directly into the SWR cache — no round-trip required.
    const res = await fetch('/api/quota/reset', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!res.ok) return;
    const next = (await res.json()) as QuotaState;
    // Optimistically write the returned state, then revalidate to
    // reconcile against the server (which should agree).
    await mutate(next, { revalidate: false });
    void mutate();
  };

  const body = data.exhausted ? (
    data.isLive ? (
      <PaidConnectPanel onBurnConfirmed={onBurnConfirmed} />
    ) : (
      <WaitlistPanel />
    )
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

function PaidConnectPanel({
  onBurnConfirmed,
}: {
  onBurnConfirmed?: (signature: string) => void;
}) {
  const t = useTranslations('predict');
  const amount = burnAmount();

  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col gap-4">
      <p className="mono tabular text-[10.5px] uppercase tracking-[0.16em] text-[var(--accent)]">
        {t('paid.label')}
      </p>

      <h3 className="text-[16px] font-semibold tracking-tight text-[var(--fg)]">
        {t('paid.title')}
      </h3>

      <p className="text-[12.5px] leading-relaxed text-[var(--fg-2)]">
        {t('paid.body', { amount: String(amount) })}
      </p>

      <div className="flex flex-col gap-2">
        <ConnectButton />
        <BurnButton onConfirmed={(sig) => onBurnConfirmed?.(sig)} />
      </div>

      <p className="mono tabular text-[9.5px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
        {t('paid.legal')}
      </p>
    </div>
  );
}
