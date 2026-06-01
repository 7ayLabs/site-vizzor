'use client';

/**
 * PredictRoute — client shell that ties together:
 *   - <ChatPanel>: the streaming chat surface
 *   - <QuotaSidebar>: free-counter / waitlist / wallet panel
 *   - <WalletAdapter>: Solana provider, lazy-loaded ONLY when the
 *     feature flag flips. Until launch this branch is unreachable
 *     in production builds, so the heavy adapter bundle never ships.
 *
 * State held here:
 *   - refreshKey: incremented after each successful chat stream so the
 *     sidebar re-fetches `/api/quota`.
 *   - burnSig: a pending burn signature awaiting consumption by the
 *     next chat submit. Read via a ref inside chat-panel so the
 *     transport's header function always sees the latest value.
 */

import dynamic from 'next/dynamic';
import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ChatPanel } from '@/components/sections/chat-panel';
import { QuotaSidebar } from '@/components/sections/quota-sidebar';
import { isTokenLive } from '@/lib/feature-flags';

// Dynamic + ssr:false:
//   1. The wallet adapter touches `window` synchronously; can't SSR.
//   2. Webpack carves it into a separate chunk; the home page and the
//      docs zone never see it.
//   3. We only invoke it when isTokenLive(), so the chunk isn't even
//      fetched in the current pre-launch deployment.
const WalletAdapter = dynamic(
  () => import('@/components/wallet/wallet-provider'),
  { ssr: false, loading: () => null },
);

export function PredictRoute() {
  const t = useTranslations('predict');
  const [refreshKey, setRefreshKey] = useState(0);
  const [burnSig, setBurnSig] = useState<string | null>(null);

  const inner: ReactNode = (
    <>
      <header className="flex flex-col gap-2">
        <p className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--accent)]">
          {t('eyebrow')}
        </p>
        <h1 className="display text-[var(--fg)] text-balance text-[28px] sm:text-[36px] lg:text-[44px] leading-[1.05] tracking-tight font-semibold">
          {t('title')}
        </h1>
        <p className="text-[15px] leading-relaxed text-[var(--fg-2)] max-w-[60ch]">
          {t('sub')}
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 min-h-[560px]">
        <div className="border border-[var(--border)] bg-[var(--bg)] p-4 flex flex-col min-h-[560px]">
          <ChatPanel
            burnSig={burnSig}
            onConsumeBurn={() => setBurnSig(null)}
            onQuotaChange={() => setRefreshKey((k) => k + 1)}
          />
        </div>

        <aside className="flex flex-col gap-4">
          <QuotaSidebar
            refreshKey={refreshKey}
            onBurnConfirmed={(sig) => setBurnSig(sig)}
          />
        </aside>
      </div>
    </>
  );

  return (
    <div className="flex flex-col gap-8">
      {isTokenLive() ? <WalletAdapter>{inner}</WalletAdapter> : inner}
    </div>
  );
}
