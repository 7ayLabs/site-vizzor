'use client';

/**
 * AccountProfile — Web3-native wallet dashboard.
 *
 * Layout (top to bottom):
 *   1. Hero — identicon + short address + full address with copy +
 *      network badge + quick actions (Sign out, Manage plan).
 *   2. Stat row — 4 compact tiles: Plan, Renews, Telegram, Activity.
 *      Big number on top, mono caption beneath. Borrowed pattern
 *      from defi portfolio dashboards (Rabby, Phantom Activity).
 *   3. Activity list — slim row-per-payment with relative timestamp,
 *      tier · cadence, chain · token, USD amount, status pill.
 *
 * The whole surface uses only the neutral token set (--bg, --surface,
 * --surface-2, --border, --fg/--fg-2/--fg-3). Status emphasis comes
 * from typography weight + `bg-[var(--fg)] text-[var(--bg)]` inversion.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, Link } from '@/i18n/navigation';
import {
  ArrowUpRight,
  Check,
  Copy,
  LogOut,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { WalletIdenticon } from './wallet-identicon';

type Cluster = 'mainnet' | 'testnet' | 'devnet';

interface SubscriptionDetail {
  tier: string;
  cadence: string;
  expiresAt: number | null;
  isLifetime: boolean;
  telegramUserId: number | null;
}

interface WalletLinkDetail {
  telegramUserId: number;
  createdAt: number;
}

interface SessionRowSummary {
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
}

interface AccountProfileProps {
  wallet: string;
  authExpiresAt: number;
  network: Cluster;
  networkBadge: string;
  subscription: SubscriptionDetail | null;
  walletLink: WalletLinkDetail | null;
  recentSessions: SessionRowSummary[];
}

const TG_USERNAME =
  process.env.NEXT_PUBLIC_TG_BOT_USERNAME ?? 'vizzorai_bot';

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatRelative(ts: number, now: number): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const day = 24 * 60 * 60 * 1000;
  const hr = 60 * 60 * 1000;
  const min = 60 * 1000;
  if (abs >= 30 * day) {
    const months = Math.round(abs / (30 * day));
    return diff > 0 ? `in ${months}mo` : `${months}mo ago`;
  }
  if (abs >= day) {
    const days = Math.round(abs / day);
    return diff > 0 ? `in ${days}d` : `${days}d ago`;
  }
  if (abs >= hr) {
    const hours = Math.round(abs / hr);
    return diff > 0 ? `in ${hours}h` : `${hours}h ago`;
  }
  const minutes = Math.max(1, Math.round(abs / min));
  return diff > 0 ? `in ${minutes}m` : `${minutes}m ago`;
}

export function AccountProfile({
  wallet,
  authExpiresAt: _authExpiresAt,
  network: _network,
  networkBadge,
  subscription,
  walletLink,
  recentSessions,
}: AccountProfileProps) {
  const t = useTranslations('account');
  const router = useRouter();
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const now = Date.now();

  const onCopyWallet = async () => {
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard policy may deny — silent */
    }
  };

  const onSignOut = async () => {
    setSignOutBusy(true);
    try {
      await fetch('/api/auth/session', { method: 'DELETE' });
    } finally {
      router.push('/');
      router.refresh();
    }
  };

  // Stat tile values
  const planLabel = subscription
    ? t(`tier.${subscription.tier}`)
    : t('stats.planNone');
  const planCadence = subscription
    ? t(`cadence.${subscription.cadence}`)
    : t('stats.planSub');

  const renewsLabel = subscription
    ? subscription.isLifetime
      ? '∞'
      : subscription.expiresAt
        ? formatRelative(subscription.expiresAt, now)
        : '—'
    : '—';
  const renewsCaption = subscription
    ? subscription.isLifetime
      ? t('stats.renewsLifetime')
      : subscription.expiresAt
        ? formatDate(subscription.expiresAt)
        : t('stats.renewsNone')
    : t('stats.renewsNone');

  const tgLabel = walletLink ? `#${walletLink.telegramUserId}` : '—';
  const tgCaption = walletLink
    ? t('stats.tgLinkedSince', { date: formatDate(walletLink.createdAt) })
    : t('stats.tgUnlinked');

  const sessionCount = recentSessions.length;
  const lastSessionRel =
    recentSessions[0]?.createdAt != null
      ? formatRelative(recentSessions[0].createdAt, now)
      : null;

  return (
    <section className="relative">
      <div className="mx-auto w-full max-w-[1040px] px-4 sm:px-6 lg:px-8 py-10 lg:py-14 flex flex-col gap-8">
        {/* ─── Hero ─── */}
        <header className="flex flex-col sm:flex-row sm:items-center gap-5">
          <WalletIdenticon address={wallet} size={64} />
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="display text-[var(--fg)] text-[28px] sm:text-[34px] leading-none tracking-tight font-semibold">
                {truncateAddress(wallet)}
              </span>
              <span className="mono tabular text-[9.5px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-2)]">
                {networkBadge}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <code className="mono tabular text-[11.5px] text-[var(--fg-3)] truncate max-w-[44ch]">
                {wallet}
              </code>
              <button
                type="button"
                onClick={onCopyWallet}
                aria-label={t('identity.copyAria')}
                title={copied ? t('identity.copied') : t('identity.copy')}
                className="
                  inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md
                  border border-[var(--border)] bg-[var(--surface)]
                  text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]
                  transition-colors
                "
              >
                {copied ? (
                  <Check size={12} strokeWidth={2.5} />
                ) : (
                  <Copy size={12} strokeWidth={2} />
                )}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:self-start">
            <Link
              href="/pricing"
              className="
                inline-flex h-9 items-center justify-center gap-1.5 px-3
                rounded-lg bg-[var(--fg)] text-[var(--bg)]
                mono tabular text-[10.5px] uppercase tracking-[0.16em] font-semibold
                hover:opacity-90 transition-opacity
              "
            >
              <span>{t('hero.manage')}</span>
              <ArrowUpRight size={12} strokeWidth={2.4} />
            </Link>
            <button
              type="button"
              onClick={onSignOut}
              disabled={signOutBusy}
              className="
                inline-flex h-9 items-center justify-center gap-1.5 px-3
                rounded-lg border border-[var(--border)] bg-[var(--surface)]
                mono tabular text-[10.5px] uppercase tracking-[0.16em] font-medium text-[var(--fg-2)]
                hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors
                disabled:opacity-50
              "
            >
              <LogOut size={12} strokeWidth={2} />
              <span>
                {signOutBusy
                  ? t('identity.signingOut')
                  : t('identity.signOut')}
              </span>
            </button>
          </div>
        </header>

        {/* ─── Stats row ─── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-2xl border border-[var(--border)] bg-[var(--border)] overflow-hidden">
          <StatTile
            label={t('stats.plan')}
            value={planLabel}
            caption={planCadence}
            inverted={!!subscription}
          />
          <StatTile
            label={t('stats.renews')}
            value={renewsLabel}
            caption={renewsCaption}
          />
          <StatTile
            label={t('stats.telegram')}
            value={tgLabel}
            caption={tgCaption}
          />
          <StatTile
            label={t('stats.activity')}
            value={String(sessionCount)}
            caption={
              lastSessionRel
                ? t('stats.lastSeen', { rel: lastSessionRel })
                : t('stats.activityEmpty')
            }
          />
        </div>

        {/* ─── Telegram link callout (only if unlinked) ─── */}
        {!walletLink && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg)]"
              >
                <Send size={15} strokeWidth={2.2} />
              </span>
              <div className="flex flex-col gap-1 min-w-0">
                <p className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
                  {t('telegram.eyebrow')}
                </p>
                <p className="text-[14px] text-[var(--fg-2)] leading-relaxed">
                  {t('telegram.unlinkedBody')}
                </p>
              </div>
            </div>
            <a
              href={`https://t.me/${TG_USERNAME}?start=link_wallet`}
              target="_blank"
              rel="noopener noreferrer"
              className="
                self-start sm:self-center
                inline-flex h-10 items-center justify-center gap-1.5 px-4
                rounded-xl bg-[var(--fg)] text-[var(--bg)]
                text-[12.5px] font-semibold tracking-tight
                hover:opacity-90 transition-opacity
              "
            >
              <span>{t('telegram.linkCta')}</span>
              <ArrowUpRight size={13} strokeWidth={2.4} />
            </a>
          </div>
        )}

        {/* ─── Activity ─── */}
        <section id="payments" className="flex flex-col gap-4 scroll-mt-20">
          <header className="flex items-baseline justify-between">
            <h2 className="text-[17px] font-semibold tracking-tight text-[var(--fg)]">
              {t('activity.title')}
            </h2>
            {walletLink && (
              <span className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-3)] inline-flex items-center gap-1.5">
                <ShieldCheck size={11} strokeWidth={2} />
                <span>
                  {t('activity.linkedTo', {
                    id: String(walletLink.telegramUserId),
                  })}
                </span>
              </span>
            )}
          </header>

          {recentSessions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center">
              <p className="text-[14px] text-[var(--fg-2)] max-w-[44ch] mx-auto">
                {t('activity.empty')}
              </p>
            </div>
          ) : (
            <ul className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)]">
              {recentSessions.map((s) => (
                <li
                  key={s.sessionId}
                  className="px-4 sm:px-5 py-3.5 flex flex-wrap items-center gap-x-4 gap-y-1"
                >
                  <span className="mono tabular text-[10.5px] uppercase tracking-[0.16em] text-[var(--fg-3)] min-w-[80px]">
                    {formatRelative(s.createdAt, now)}
                  </span>
                  <span className="text-[13.5px] font-medium text-[var(--fg)]">
                    {t(`tier.${s.tier}`)} ·{' '}
                    <span className="text-[var(--fg-2)] font-normal">
                      {t(`cadence.${s.cadence}`)}
                    </span>
                  </span>
                  <span className="mono tabular text-[11px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
                    {s.chain} · {s.token}
                  </span>
                  <span className="ml-auto flex items-center gap-3">
                    <span className="mono tabular text-[14px] text-[var(--fg)]">
                      ${(s.amountUsdCents / 100).toFixed(2)}
                    </span>
                    <StatusPill status={s.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

/* ────────────── primitives ────────────── */

function StatTile({
  label,
  value,
  caption,
  inverted = false,
}: {
  label: string;
  value: string;
  caption: string;
  inverted?: boolean;
}) {
  const bg = inverted ? 'bg-[var(--fg)]' : 'bg-[var(--surface)]';
  const fg = inverted ? 'text-[var(--bg)]' : 'text-[var(--fg)]';
  const subFg = inverted ? 'text-[var(--bg)] opacity-70' : 'text-[var(--fg-3)]';
  return (
    <div className={`${bg} p-4 sm:p-5 flex flex-col gap-1.5`}>
      <span
        className={`mono tabular text-[10px] uppercase tracking-[0.18em] ${subFg}`}
      >
        {label}
      </span>
      <span
        className={`text-[24px] sm:text-[26px] font-semibold tracking-tight leading-none ${fg}`}
      >
        {value}
      </span>
      <span
        className={`mono tabular text-[10.5px] tracking-[0.04em] ${subFg} truncate`}
      >
        {caption}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const t = useTranslations('account.activity.status');
  const isConfirmed = status === 'confirmed';
  return (
    <span
      className={`
        mono tabular text-[9.5px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-md inline-flex items-center gap-1
        ${
          isConfirmed
            ? 'bg-[var(--fg)] text-[var(--bg)]'
            : 'border border-[var(--border)] text-[var(--fg-2)]'
        }
      `}
    >
      {t(status as 'confirmed') ?? status}
    </span>
  );
}
