/**
 * /account — wallet profile + subscription overview.
 *
 * Server-rendered using the SIWS auth session cookie. Surfaces every
 * piece of identity / payment state the system tracks for the active
 * wallet:
 *
 *   - Wallet identity (address, signed-in expiry, network)
 *   - Subscription (tier, cadence, expiry, renewal CTA)
 *   - Telegram link (linked: handle, unlinked: CTA to /link)
 *   - Recent payment sessions (last 10, status, chain, amount)
 *
 * The page is signed-in-only. Anonymous visitors are redirected to
 * /predict where the navbar wallet button surfaces the sign-in flow.
 *
 * Color discipline: this page uses only the neutral token set
 * (--bg / --surface / --surface-2 / --border / --fg{,2,3}). Status
 * dots and active-tier emphasis come from typography weight and
 * `bg-[var(--fg)] text-[var(--bg)]` inversion, not from --accent /
 * --gold / --whale.
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
    redirect(`/${locale}/predict?from=account`);
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

/**
 * Pulls the last 10 payment sessions for the active wallet — confirmed
 * or otherwise — so the user has a receipt-style trail of their
 * activity. The payer_address column on payment_sessions is the
 * authoritative join key (it's set by the watcher on confirmation).
 */
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
