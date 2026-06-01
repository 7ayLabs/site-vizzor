'use client';

/**
 * PredictRoute — client shell that wires <ChatPanel> to <QuotaSidebar>
 * via a shared refresh signal. Whenever the chat finishes a stream,
 * the sidebar refetches `/api/quota` so the counter ticks down in
 * real time without a full reload.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChatPanel } from '@/components/sections/chat-panel';
import { QuotaSidebar } from '@/components/sections/quota-sidebar';

export function PredictRoute() {
  const t = useTranslations('predict');
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex flex-col gap-8">
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
        {/* Chat column */}
        <div className="border border-[var(--border)] bg-[var(--bg)] p-4 flex flex-col min-h-[560px]">
          <ChatPanel onQuotaChange={() => setRefreshKey((k) => k + 1)} />
        </div>

        {/* Sidebar column */}
        <aside className="flex flex-col gap-4">
          <QuotaSidebar refreshKey={refreshKey} />
        </aside>
      </div>
    </div>
  );
}
