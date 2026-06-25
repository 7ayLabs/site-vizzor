'use client';

/**
 * ProductSidebar — predict-shell-style left rail for non-predict
 * surfaces on `app.vizzor.ai`.
 *
 * Visually mirrors `LeftRail` from `predict-shell.tsx` (vizzor brand,
 * New run / Run / Alerts / Receipts nav, Recent chats list, wallet
 * Identity pill at the bottom) so every page on the product host
 * shares the same chrome the predict surface owns. The marketing
 * routes (`/account`, `/pricing`, `/pay/...`, etc.) were previously
 * mounting the umbrella `AppSidebar` with a different vocabulary
 * (Surfaces / Whales / Flow / Settings / Billing / Pricing / Docs)
 * — Zaid flagged the inconsistency: predict's left rail is THE
 * product chrome, the rest must follow.
 *
 * Behavioral diffs from `LeftRail`:
 *   - `New run` and `Run` both navigate to `/app/predict`. The new-
 *     run case appends `?action=new` so the shell mints a fresh
 *     conversation on mount instead of resuming the active thread.
 *   - `Alerts` routes to `/app/alerts` (the dedicated surface, not
 *     the predict modal).
 *   - `Receipts` routes to `/account#recent-payments` which is where
 *     the on-chain receipts live (the predict modal opens that page
 *     in a panel; here we just take the user straight to it).
 *   - `Recent chats` rows route to `/app/predict?conversation=<id>`
 *     so the chat shell resumes the thread.
 *
 * Stays mounted at `lg+`; mobile keeps the minimal `AppHostTopbar`
 * for the back-to-predict anchor (same contract `AppSidebar` had).
 */

import { useMemo, useState, useRef, useEffect, type ReactNode } from 'react';
import Image from 'next/image';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { paymentNetwork } from '@/lib/payment/network';
import { buildSolscanAccountUrl } from '@/lib/explorer/solana';
import { useConversations } from '@/components/predict/use-conversations';
import {
  IconBell,
  IconChat,
  IconClose,
  IconHelp,
  IconPlus,
  IconReceipts,
  IconSettings,
} from '@/components/predict/predict-icons';

interface SessionState {
  ok?: boolean;
  signedIn?: boolean;
  wallet?: string;
  subscription?: {
    tier: string;
    cadence: string;
    expiresAt: number | null;
    isLifetime: boolean;
  } | null;
}

const fetcher = (url: string): Promise<SessionState> =>
  fetch(url, { credentials: 'same-origin' }).then((r) => r.json());

export function ProductSidebar() {
  const t = useTranslations('predict');
  const pathname = usePathname();
  const { data: session } = useSWR<SessionState>(
    '/api/auth/session',
    fetcher,
    { refreshInterval: 20_000, revalidateOnFocus: true, keepPreviousData: true },
  );
  const signedIn = !!session?.signedIn;
  const wallet = session?.wallet;

  const { conversations } = useConversations({ enabled: signedIn });
  const recent = useMemo(() => conversations.slice(0, 12), [conversations]);

  const onPredict = /^\/app\/predict(\/|$)/.test(pathname);
  const onAlerts = /^\/app\/alerts(\/|$)/.test(pathname);
  const onAccount = /^\/account(\/|$)/.test(pathname);

  return (
    <aside
      className="
        hidden lg:flex flex-col
        w-[280px] shrink-0 h-dvh sticky top-0
        border-r border-[var(--border)] bg-[var(--surface)]
        p-4
      "
      aria-label="Vizzor product navigation"
    >
      {/* Brand — same treatment as predict-shell LeftRail. */}
      <div className="flex items-center justify-between mb-3">
        <Link
          href="/app/predict"
          aria-label="Vizzor home"
          className="inline-flex items-center gap-2.5 text-[17px] font-semibold tracking-tight text-[var(--fg)] hover:opacity-80 transition-opacity leading-none"
        >
          <Image
            src="/brand/vizzor_darkicon.png"
            alt=""
            width={364}
            height={535}
            priority
            className="block dark:hidden h-7 w-auto"
          />
          <Image
            src="/brand/vizzor_icon.png"
            alt=""
            width={364}
            height={535}
            priority
            className="hidden dark:block h-7 w-auto"
          />
          <span>vizzor</span>
        </Link>
      </div>

      {/* Primary nav. New run → predict with action=new; Run → predict
          active thread; Alerts → /app/alerts; Receipts → account
          page's payments section. Same icon set the predict-shell
          uses so the vocabulary is identical. */}
      <nav className="flex flex-col gap-0.5" aria-label="Surfaces">
        <NavLink
          href="/app/predict?action=new"
          icon={<IconPlus size={17} />}
          label={t('shell.newChat')}
          active={false}
        />
        <NavLink
          href="/app/predict"
          icon={<IconChat size={17} />}
          label={t('shell.nav.chat')}
          active={onPredict}
        />
        <NavLink
          href="/app/alerts"
          icon={<IconBell size={17} />}
          label={t('shell.nav.alerts')}
          active={onAlerts}
        />
        <NavLink
          href="/account#recent-payments"
          icon={<IconReceipts size={17} />}
          label={t('shell.nav.receipts')}
          active={onAccount}
        />
      </nav>

      {/* Recent chats — fetched via the same SWR key the predict
          shell uses, so the lists agree across surfaces. Each row
          deep-links into /app/predict?conversation=<id>. Empty
          state mirrors the predict shell's dashed-border card. */}
      <div className="mt-5 flex-1 min-h-0 overflow-y-auto flex flex-col gap-1">
        <div className="flex items-center justify-between px-3">
          <span className="text-[10.5px] uppercase tracking-[0.16em] text-[var(--fg-3)] font-semibold">
            {t('shell.recents.label')}
          </span>
        </div>
        {recent.length === 0 ? (
          <div className="mx-3 mt-1 flex flex-col gap-1.5 px-3 py-3 rounded-md border border-dashed border-[var(--border)]">
            <span className="mono tabular text-[9.5px] uppercase tracking-[0.18em] font-semibold text-[var(--fg-3)]">
              {t('shell.recents.emptyEyebrow')}
            </span>
            <p className="text-[11.5px] text-[var(--fg-3)] leading-snug">
              {signedIn
                ? t('shell.recents.empty')
                : t('shell.recents.signInPrompt')}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {recent.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/app/predict?conversation=${encodeURIComponent(c.id)}` as never}
                  className="
                    group w-full flex items-center gap-2 text-left
                    pl-3 pr-3 py-1.5 rounded-md
                    text-[12px] truncate
                    text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]
                    transition-colors
                  "
                  title={c.title}
                >
                  <span aria-hidden className="text-[var(--fg-3)]">
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                      <circle cx="4" cy="4" r="1.5" />
                    </svg>
                  </span>
                  <span className="truncate">{c.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Identity dropdown — same composition the predict-shell uses
          (wallet header → subscription → network → actions). The
          richer version was upgraded in the previous pass; we render
          it here so both surfaces share the same dropdown. */}
      <div className="shrink-0 border-t border-[var(--border)] -mx-4 px-4 py-3 mt-2">
        <Identity signedIn={signedIn} wallet={wallet} session={session} />
      </div>
    </aside>
  );
}

function NavLink({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href as never}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group w-full flex items-center gap-2.5 text-left',
        'px-3 py-2 rounded-md text-[13px]',
        'transition-colors',
        active
          ? 'bg-[var(--surface-2)] text-[var(--fg)] font-medium'
          : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'transition-colors',
          active
            ? 'text-[var(--fg)]'
            : 'text-[var(--fg-3)] group-hover:text-[var(--fg)]',
        )}
      >
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
    </Link>
  );
}

/* ─────────────────────────── Identity ─────────────────────────── */

function tierBadgeFor(sub: SessionState['subscription'] | undefined): string | null {
  if (!sub) return null;
  const cadenceLabel = sub.isLifetime
    ? 'Lifetime'
    : sub.cadence.charAt(0).toUpperCase() + sub.cadence.slice(1);
  return `${sub.tier.toUpperCase()} · ${cadenceLabel}`;
}

function Identity({
  signedIn,
  wallet,
  session,
}: {
  signedIn: boolean;
  wallet: string | undefined;
  session: SessionState | undefined;
}) {
  const t = useTranslations('predict.shell');
  const tAuth = useTranslations('auth');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const subscription = session?.subscription ?? null;
  const tierBadge = tierBadgeFor(subscription);
  const network = paymentNetwork();
  const short =
    signedIn && wallet
      ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}`
      : t('identityName');
  const meta = signedIn ? t('identityConnected') : t('identityMeta');

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent): void => {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const onSignOut = async () => {
    setOpen(false);
    try {
      await fetch('/api/auth/session', {
        method: 'DELETE',
        credentials: 'same-origin',
      });
    } finally {
      window.location.reload();
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-[var(--surface-2)] transition-colors"
      >
        <span
          aria-hidden
          className="inline-flex h-8 w-8 items-center justify-center shrink-0 rounded-full bg-[var(--fg)] text-[var(--bg)] text-[12px] font-bold"
        >
          V
        </span>
        <span className="min-w-0 flex flex-col leading-tight flex-1 text-left">
          <span className="text-[12.5px] font-semibold text-[var(--fg)] truncate mono tabular">
            {short}
          </span>
          <span className="text-[11px] text-[var(--fg-3)] truncate">{meta}</span>
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="
            absolute z-50 w-[min(280px,calc(100vw-24px))]
            left-0 bottom-full mb-2
            rounded-2xl border border-[var(--border)] bg-[var(--surface)]
            shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)]
            overflow-hidden
          "
        >
          {signedIn && wallet && (
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <p className="mono tabular text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--fg-3)]">
                {tAuth('signedInAs')}
              </p>
              <p className="mono tabular text-[11.5px] text-[var(--fg)] break-all mt-1.5">
                {wallet}
              </p>
            </div>
          )}
          {signedIn && tierBadge && (
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <p className="mono tabular text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--fg-3)]">
                {tAuth('subscription')}
              </p>
              <p className="text-[13px] font-medium tracking-tight text-[var(--fg)] mt-1.5">
                {tierBadge}
              </p>
              {subscription?.expiresAt && !subscription.isLifetime && (
                <p className="mono tabular text-[10px] text-[var(--fg-3)] mt-0.5">
                  {tAuth('expiresOn', {
                    date: new Date(subscription.expiresAt).toLocaleDateString(),
                  })}
                </p>
              )}
            </div>
          )}
          {signedIn && wallet && (
            <div className="px-4 py-3 border-b border-[var(--border)] flex flex-col gap-2">
              <p className="mono tabular text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--fg-3)]">
                {tAuth('network')}
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className="mono tabular text-[10.5px] uppercase tracking-[0.16em] px-2 py-0.5 rounded-md bg-[var(--fg)] text-[var(--bg)]">
                  Solana {network}
                </span>
                <a
                  href={buildSolscanAccountUrl(wallet, network)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center gap-1 text-[11.5px] font-medium tracking-tight text-[var(--fg-2)] hover:text-[var(--fg)] transition-colors"
                >
                  <span>{tAuth('viewOnExplorer')}</span>
                  <ArrowUpRight size={11} strokeWidth={2} />
                </a>
              </div>
            </div>
          )}
          <div className="p-1">
            <MenuLink
              href="/account"
              icon={<IconSettings size={15} />}
              label={t('settings')}
              onClick={() => setOpen(false)}
            />
            {signedIn && (
              <MenuLink
                href="/account"
                icon={<IconClose size={15} />}
                label={tAuth('viewProfile')}
                onClick={() => setOpen(false)}
              />
            )}
            <MenuLink
              href="/docs"
              icon={<IconHelp size={15} />}
              label={t('help')}
              onClick={() => setOpen(false)}
            />
            {signedIn && (
              <button
                type="button"
                role="menuitem"
                onClick={() => void onSignOut()}
                className="
                  group w-full flex items-center gap-2.5 text-left
                  h-8 px-2.5 rounded-md text-[13px]
                  text-[var(--fg-2)] hover:text-[var(--danger)]
                  hover:bg-[color-mix(in_oklab,var(--danger)_10%,transparent)]
                  transition-colors
                "
              >
                <span
                  aria-hidden
                  className="text-[var(--fg-3)] group-hover:text-[var(--danger)] transition-colors"
                >
                  <IconClose size={15} />
                </span>
                <span className="flex-1 truncate">{tAuth('signOut')}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  label,
  onClick,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href as never}
      role="menuitem"
      onClick={onClick}
      className="
        group w-full flex items-center gap-2.5 text-left
        h-8 px-2.5 rounded-md text-[13px]
        text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]
        transition-colors
      "
    >
      <span
        aria-hidden
        className="text-[var(--fg-3)] group-hover:text-[var(--fg)] transition-colors"
      >
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
    </Link>
  );
}
