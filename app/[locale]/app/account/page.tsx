/**
 * /app/account — wallet profile + subscription overview (app surface).
 *
 * Moved out of `(marketing)/account` so the user's profile + receipts
 * live inside the app shell — the user's mental model is "app stuff is
 * under /app/*". The marketing `/account` route is now a server
 * redirect to here, preserving any external bookmarks.
 *
 * Behavior identical to the previous marketing version:
 *   - Wallet identity (address, signed-in expiry, network)
 *   - Subscription (tier, cadence, expiry, renewal CTA)
 *   - Telegram link (linked: handle, unlinked: CTA to /link)
 *   - Recent payment sessions (last 10, status, chain, amount)
 *
 * Anonymous visitors are redirected to /app/predict where the navbar
 * wallet button surfaces the sign-in flow.
 */

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import {
  findActiveSubscriptionByWallet,
  findWalletLinkByWallet,
  getDb,
  type SessionRow,
} from '@/lib/payment/db';
import { paymentNetwork, networkBadgeLabel } from '@/lib/payment/network';
import { AccountProfile } from '@/components/account/account-profile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account' });
  return {
    title: t('meta.title'),
    description: t('meta.description'),
  };
}

export default async function AccountPage({ params }: PageProps) {
  const { locale } = await params;
  const session = await getActiveSession();
  if (!session) {
    redirect(`/${locale}/app/predict?from=account`);
  }

  const wallet = session.wallet;
  const now = Date.now();

  const subscription = findActiveSubscriptionByWallet(wallet, now);
  const walletLink = findWalletLinkByWallet(wallet);
  const recentSessions = listRecentSessionsForWallet(wallet);

  return (
    <AccountProfile
      wallet={wallet}
      authExpiresAt={session.expiresAt}
      network={paymentNetwork()}
      networkBadge={networkBadgeLabel()}
      subscription={
        subscription
          ? {
              tier: subscription.tier,
              cadence: subscription.cadence,
              expiresAt: subscription.expires_at,
              isLifetime: subscription.expires_at === null,
              telegramUserId: subscription.telegram_user_id,
              scheduledAction: subscription.scheduled_action,
            }
          : null
      }
      walletLink={
        walletLink
          ? {
              telegramUserId: walletLink.telegram_user_id,
              createdAt: walletLink.linked_at,
            }
          : null
      }
      recentSessions={recentSessions}
    />
  );
}

function listRecentSessionsForWallet(wallet: string): Array<{
  sessionId: string;
  tier: string;
  cadence: string;
  chain: string;
  token: string;
  amount: number;
  amountUsdCents: number;
  status: string;
  createdAt: number;
  confirmedAt: number | null;
  txSig: string | null;
}> {
  const rows = getDb()
    .prepare<[string], SessionRow>(
      `SELECT * FROM payment_sessions
        WHERE payer_address = ?
        ORDER BY created_at DESC
        LIMIT 10`,
    )
    .all(wallet);
  return rows.map((r) => ({
    sessionId: r.session_id,
    tier: r.tier,
    cadence: r.cadence,
    chain: r.chain,
    token: r.token,
    amount: r.amount,
    amountUsdCents: r.amount_usd_cents,
    status: r.status,
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at,
    txSig: r.tx_sig,
  }));
}
