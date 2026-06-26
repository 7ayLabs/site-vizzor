/**
 * /telegram-pair — Bridge between the Vizzor Telegram bot's /setup command
 * and a paid wallet identity on the website.
 *
 * Flow:
 *   1. Bot's /setup command sends the user
 *      `${origin}/telegram-pair?tg=<telegram_user_id>`.
 *   2. User opens it in browser. If not signed in, sees a Connect-wallet
 *      CTA (same SIWS modal as /cli-pair, with the same dev bypass
 *      under NEXT_PUBLIC_ALLOW_DEV_AUTH=true).
 *   3. After SIWS, the page POSTs to /api/telegram-pair/link which
 *      writes a wallet_links row binding wallet ↔ telegram_user_id.
 *   4. Page shows a success card with the bound tier. Bot's existing
 *      subscription-sync resolves the wallet's tier on the next message
 *      so the user becomes Pro/Elite on the bot immediately.
 */

import type { ReactElement } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import { TelegramPairIsland } from '@/components/cli-pair/telegram-pair-island';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tg?: string }>;
}

export default async function TelegramPairPage({
  params,
  searchParams,
}: PageProps): Promise<ReactElement> {
  const { locale } = await params;
  setRequestLocale(locale);
  const { tg } = await searchParams;
  const session = await getActiveSession();
  const telegramUserId = tg ? Number.parseInt(tg, 10) : null;
  const validTelegramId = Number.isFinite(telegramUserId) && (telegramUserId ?? 0) > 0;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-4 text-3xl font-bold tracking-tight">
        ✈️ Pair your Telegram with Vizzor
      </h1>
      <p className="mb-8 text-zinc-400">
        Sign with your wallet to link your Telegram account to your Vizzor
        plan (Free / Pro / Elite). After linking, every message you send
        to the bot resolves your plan from this wallet automatically.
      </p>

      {tg ? (
        <div className="mb-6 rounded-md border border-zinc-700 bg-zinc-900/40 px-4 py-2 text-sm">
          <span className="text-zinc-500">Telegram user id:</span>{' '}
          <code className="text-zinc-200">{tg}</code>
        </div>
      ) : null}

      {validTelegramId ? (
        <TelegramPairIsland
          isSignedIn={session !== null}
          walletAddress={session?.wallet ?? null}
          telegramUserId={telegramUserId as number}
        />
      ) : (
        <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-6 text-sm text-red-300">
          Missing or invalid <code>?tg=</code> parameter. Run <code>/setup</code> in
          the Vizzor Telegram bot to get a valid pair URL.
        </div>
      )}

      <p className="mt-10 text-xs text-zinc-600">
        Pairing writes a single row binding your wallet to your Telegram
        user id. The bot's subscription resolver picks up the link on the
        next message — usually within seconds.
      </p>
    </main>
  );
}
