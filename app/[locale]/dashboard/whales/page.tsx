/**
 * /[locale]/dashboard/whales — Whale Terminal (Elite tier).
 *
 * Server-rendered Elite-gated landing for the on-chain whale terminal
 * advertised on the public pricing page. Gating order:
 *
 *   1. No SIWS session  → redirect to /predict?from=dashboard-whales
 *      (the predict page surfaces the sign-in flow)
 *   2. No subscription  → redirect to /pricing?reason=elite
 *   3. Subscription tier != elite → redirect to /pricing?reason=elite
 *   4. Active Elite     → render the terminal shell
 *
 * v0.2.x scope: the surface is the gating + shell + status banner. Live
 * whale data flows through the Telegram `/whale <SYMBOL>` command today
 * (Vega §8 entitlement map gates that the same way). The full web data
 * stream is wired in a follow-up release that exposes the engine's
 * smart-money-flow signal over `/v1/forensics/whales` — until then the
 * "live data" CTA points the user at the working bot surface.
 *
 * Honesty: this page never renders fabricated whale numbers. If the
 * REST data path is not wired, the panel shows the same "Live in
 * Telegram today" message rather than placeholder figures.
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
  title: 'Whale Terminal · Vizzor',
  description:
    'Real-time on-chain whale moves, smart-money flow, top-20 holder concentration. Elite tier.',
};

export default async function WhaleTerminalPage({ params }: PageProps) {
  const { locale } = await params;

  const session = await getActiveSession();
  if (!session) redirect(`/${locale}/predict?from=dashboard-whales`);

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
          Whale Terminal
        </h1>
        <p className="mt-3 max-w-2xl text-base text-[var(--fg-2)]">
          Real-time on-chain whale moves, scoped per token: top-20 holder
          breakdown with smart-money labels, exchange net-flow, cold→hot
          transfers, and stablecoin print events feeding the predictor.
        </p>
      </header>

      <div className="mb-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-[var(--fg-3)]">
              Status
            </p>
            <p className="mt-1 text-sm text-[var(--fg)]">
              Live data via the Telegram bot today · web stream rolling out
            </p>
          </div>
          <a
            href="https://t.me/vizzorai_bot"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--fg)] px-4 py-2 text-sm font-medium text-[var(--bg)] transition-opacity hover:opacity-90"
          >
            Open /whale on Telegram →
          </a>
        </div>
      </div>

      <section className="grid gap-5 md:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-5">
          <h2 className="text-base font-medium">What you get</h2>
          <ul className="mt-3 space-y-2 text-sm text-[var(--fg-2)]">
            <li>• Top-20 holders with smart-money labels (exchange · OTC · whale · dev · contract)</li>
            <li>• Accumulating / distributing / holding state per whale</li>
            <li>• Exchange net-flow (1h rolling window) — outflow = bullish, inflow = bearish</li>
            <li>• Cold→hot transfer detection (same-exchange liquidity prep)</li>
            <li>• Stablecoin mint / burn events (Tether + Circle, 1h)</li>
            <li>• Top $1M+ transactions in window with directional attribution</li>
          </ul>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-5">
          <h2 className="text-base font-medium">How to use it now</h2>
          <ol className="mt-3 space-y-2 text-sm text-[var(--fg-2)]">
            <li>
              1. Open <span className="font-mono">/whale &lt;SYM&gt;</span> on the bot
            </li>
            <li>2. Vizzor returns the full terminal: activity, flow, mints, top txs</li>
            <li>
              3. Re-run with <span className="font-mono">🔄 Refresh</span> for a fresh window
            </li>
          </ol>
          <p className="mt-4 text-xs text-[var(--fg-3)]">
            Web stream (per-symbol live feed) lands in v0.3 · auto-arming alerts on whale
            triggers and shareable signal cards already live in Elite.
          </p>
        </div>
      </section>

      <footer className="mt-10 border-t border-[var(--border)] pt-5 text-xs text-[var(--fg-3)]">
        Whale Terminal is part of Vizzor Elite. Tier: {tier}. Wallet:{' '}
        <span className="font-mono">
          {session.wallet.slice(0, 4)}…{session.wallet.slice(-4)}
        </span>
        .
      </footer>
    </div>
  );
}
