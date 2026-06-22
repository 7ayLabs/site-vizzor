/**
 * POST /api/telegram-pair/link
 *
 * Last step of the Telegram pair flow. The user has already signed SIWS
 * on /telegram-pair?tg=<id> (cookie session is hot); this endpoint
 * writes a wallet_links row binding their Solana wallet to their
 * Telegram user id. Once written, every engine call to
 * `/api/subscriptions/lookup?telegram_user_id=<id>` resolves the
 * wallet's tier — so the bot sees the user as Pro/Elite immediately
 * after they upgrade on the web.
 *
 * Flow:
 *   1. Verify active SIWS session.
 *   2. Read `?tg=<id>` from the body — must be a positive integer.
 *   3. Insert wallet_links row with strict mode; surface
 *      `already_linked_elsewhere` if the wallet is already bound to
 *      a different Telegram id.
 *   4. Return success with the resolved tier so the page can show the
 *      operator what plan they now have on the bot.
 */

import { getActiveSession } from '@/lib/payment/auth-session';
import { insertWalletLink, findWalletLinkByTelegramId } from '@/lib/payment/db';
import { resolveTier } from '@/lib/payment/tier-resolver';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface LinkRequestBody {
  telegramUserId?: number | string;
}

export async function POST(req: Request): Promise<Response> {
  const session = await getActiveSession();
  if (!session) {
    return Response.json(
      { error: 'auth_required', message: 'Sign in with your wallet first.' },
      { status: 401 },
    );
  }

  let body: LinkRequestBody;
  try {
    body = (await req.json()) as LinkRequestBody;
  } catch {
    return Response.json(
      { error: 'malformed_body', message: 'Body must be JSON.' },
      { status: 400 },
    );
  }

  const tgRaw = body.telegramUserId;
  const telegramUserId =
    typeof tgRaw === 'string' ? Number.parseInt(tgRaw, 10) : Number(tgRaw);
  if (!Number.isFinite(telegramUserId) || telegramUserId <= 0) {
    return Response.json(
      { error: 'bad_telegram_id', message: 'telegramUserId must be a positive integer.' },
      { status: 400 },
    );
  }

  // Check if this Telegram user is already linked to a different wallet.
  const existing = findWalletLinkByTelegramId(telegramUserId);
  if (existing && existing.wallet_address !== session.wallet) {
    return Response.json(
      {
        error: 'already_linked_elsewhere',
        message: `Telegram user ${telegramUserId} is already linked to a different wallet (${truncate(existing.wallet_address)}).`,
      },
      { status: 409 },
    );
  }

  try {
    insertWalletLink(
      {
        telegram_user_id: telegramUserId,
        wallet_address: session.wallet,
        siws_token: null,
      },
      { strict: false },
    );
  } catch (err) {
    return Response.json(
      {
        error: 'link_failed',
        message: `Failed to record wallet_links row: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }

  const effective = resolveTier(session.wallet);
  const tier =
    effective.kind === 'elite' ? 'elite' : effective.kind === 'pro' ? 'pro' : 'free';

  return Response.json({
    ok: true,
    walletAddress: session.wallet,
    telegramUserId,
    tier,
  });
}

function truncate(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}
