'use client';

/**
 * PredictRoute — client shell mounted INSIDE the dashboard layout.
 *
 * Now scoped narrower than before: just the chat + quota sidebar +
 * (when token live) wallet adapter. The dashboard header, stat cards,
 * tier donut, and predictions table are all server components owned
 * by `app/[locale]/predict/page.tsx`. This split keeps the page's
 * initial HTML rich (all dashboard panels SSR'd from the snapshot)
 * while the chat — which needs streaming + state — stays client-side.
 */

import dynamic from 'next/dynamic';
import { useState, type ReactNode } from 'react';
import { ChatPanel } from '@/components/sections/chat-panel';
import { QuotaSidebar } from '@/components/sections/quota-sidebar';
import { isTokenLive } from '@/lib/feature-flags';

const WalletAdapter = dynamic(
  () => import('@/components/wallet/wallet-provider'),
  { ssr: false, loading: () => null },
);

export function PredictRoute() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [burnSig, setBurnSig] = useState<string | null>(null);

  const inner: ReactNode = (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-4 min-h-[520px]">
      <div className="border border-[var(--border)] bg-[var(--bg)] p-4 flex flex-col min-h-[520px]">
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
  );

  return isTokenLive() ? <WalletAdapter>{inner}</WalletAdapter> : inner;
}
