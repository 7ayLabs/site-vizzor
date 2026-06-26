/**
 * /[locale]/app/flow — Cross-venue Flow Heatmap (Elite tier).
 *
 * Server-rendered Elite-gated landing for the venue × token capital-
 * flow heatmap advertised on the public pricing page. Same gating
 * sequence as `/app/whales`:
 *
 *   1. No SIWS session  → /app/predict?from=flow
 *   2. No subscription  → /pricing?reason=elite
 *   3. Tier != elite    → /pricing?reason=elite
 *   4. Active Elite     → render the heatmap shell
 *
 * v0.2.x scope: gating + shell + status banner. The matrix render
 * subscribes to the engine's cross-venue-funding signal in a follow-up
 * release; until then the surface points to the engine signal that
 * already feeds Predictor calls. The pricing copy under "Cross-venue
 * intelligence" is honest about the cadence (every 30 s, not every
 * block) so this page stays consistent.
 */

import { redirect } from 'next/navigation';
import { getActiveSession } from '@/lib/payment/auth-session';
import { findActiveSubscriptionByWallet } from '@/lib/payment/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = {
  title: 'Flow Heatmap · Vizzor',
  description:
    'Venue × token capital-flow heatmap with funding-z divergence and cross-venue premium. Elite tier.',
};

export default async function FlowHeatmapPage({ params }: PageProps) {
  const { locale } = await params;

  const session = await getActiveSession();
  if (!session) redirect(`/${locale}/app/predict?from=flow`);

  const subscription = findActiveSubscriptionByWallet(session.wallet, Date.now());
  const tier = subscription?.tier ?? null;
  if (tier !== 'elite') {
    redirect(`/${locale}/pricing?reason=elite`);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 md:py-16">
      <header className="mb-8">
        <p className="text-sm text-[var(--fg-3)]">Elite · Dashboard</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">
          Flow Heatmap
        </h1>
        <p className="mt-3 max-w-2xl text-base text-[var(--fg-2)]">
          Cross-venue capital flow — funding-rate divergence, premium spreads,
          and venue arbitrage signals across Binance, Bybit, OKX, Deribit, and
          Hyperliquid. Refreshed every 30 seconds, feeding the predictor.
        </p>
      </header>

      <div className="mb-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-[var(--fg-3)]">
              Status
            </p>
            <p className="mt-1 text-sm text-[var(--fg)]">
              Cross-venue signals already feed every Predictor call · standalone heatmap
              view rolling out
            </p>
          </div>
          <a
            href={`/${locale}/app/predict?from=flow`}
            className="inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--fg)] px-4 py-2 text-sm font-medium text-[var(--bg)] transition-opacity hover:opacity-90"
          >
            Open Predictor →
          </a>
        </div>
      </div>

      <section className="grid gap-5 md:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-5">
          <h2 className="text-base font-medium">Signals in the matrix</h2>
          <ul className="mt-3 space-y-2 text-sm text-[var(--fg-2)]">
            <li>• Funding rate per venue (Binance · Bybit · OKX)</li>
            <li>• Funding-z divergence (Binance vs others — positive = Binance hotter)</li>
            <li>• Largest pairwise venue spread per token</li>
            <li>• Open-interest delta (1h rolling)</li>
            <li>• Options IV / skew (Deribit + Hyperliquid)</li>
            <li>• Premium spreads vs spot reference</li>
          </ul>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-5">
          <h2 className="text-base font-medium">How to read it</h2>
          <ol className="mt-3 space-y-2 text-sm text-[var(--fg-2)]">
            <li>
              <strong>Hot cells</strong> = venue arbitrage opportunity. Funding-z &gt; 1.5σ
              flags directional bias.
            </li>
            <li>
              <strong>Cold cells</strong> = venues in sync. Predictor downgrades cross-venue
              signal weight.
            </li>
            <li>
              <strong>Sign of divergence</strong> tells you which side is paying — positive
              funding-z = longs paying shorts.
            </li>
          </ol>
          <p className="mt-4 text-xs text-[var(--fg-3)]">
            Standalone heatmap render lands in v0.3 · the underlying signal already
            contributes to every prediction (see /diagnose).
          </p>
        </div>
      </section>

      <footer className="mt-10 border-t border-[var(--border)] pt-5 text-xs text-[var(--fg-3)]">
        Flow Heatmap is part of Vizzor Elite. Tier: {tier}. Wallet:{' '}
        <span className="font-mono">
          {session.wallet.slice(0, 4)}…{session.wallet.slice(-4)}
        </span>
        .
      </footer>
    </div>
  );
}
