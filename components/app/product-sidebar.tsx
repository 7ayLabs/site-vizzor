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
import { useTranslations, useLocale } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { paymentNetwork } from '@/lib/payment/network';
import { buildSolscanAccountUrl } from '@/lib/explorer/solana';
import { useConversations } from '@/components/predict/use-conversations';
import { AlertsModal } from '@/components/predict/alerts-modal';
import { SettingsSheet } from '@/components/predict/settings-sheet';
import {
  IconBell,
  IconChat,
  IconClose,
  IconHelp,
  IconPlus,
  IconReceipts,
  IconSettings,
} from '@/components/predict/predict-icons';
import { Boxes } from 'lucide-react';

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
  const router = useRouter();
  const locale = useLocale();
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
  // `Receipts` opens /account#payments but is NOT a Receipts surface —
  // it's a profile + activity dashboard. Highlighting `Receipts` while
  // the user is on /account misreads as "you're on the Receipts page",
  // so we don't flip the active state for that route. The viewProfile
  // menu item inside the Identity dropdown is the canonical entrypoint
  // for /account.

  // Mirror predict-shell action contract: Alerts opens an in-place
  // modal (same AlertsList the /app/alerts page uses), Settings
  // opens a SettingsSheet (theme/locale/clear-local), Receipts
  // navigates to /account#payments. The user gets identical
  // behavior from this sidebar and from the chat surface's LeftRail.
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const onOpenAlerts = () => setAlertsOpen(true);
  const onOpenSettings = () => setSettingsOpen(true);
  const onOpenReceipts = () => {
    // typedRoutes doesn't yet know about hashes — cast through never.
    router.push('/app/account#payments' as never);
  };

  // Collapse state — shares the same localStorage key as the predict
  // shell so toggling the rail on /predict carries over to /account
  // and vice versa. Default uncollapsed; hydrated in an effect so SSR
  // matches the first client paint.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('vizzor.predict.sidebarCollapsed');
      if (stored === '1') setCollapsed(true);
    } catch {
      /* localStorage blocked — accept the default */
    }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        window.localStorage.setItem('vizzor.predict.sidebarCollapsed', next ? '1' : '0');
      } catch {
        /* localStorage blocked — ephemeral toggle, that's fine */
      }
      return next;
    });
  };

  return (
    <>
    <aside
      className={cn(
        // Mirror predict-shell's LeftRail: NO `--surface` fill (so the
        // aside reads as a continuation of the page, not a separate
        // panel), a single hairline `border-r` to separate it from the
        // main column. Same width / collapsed-width as predict-shell:
        // 280px / 64px. Sticky to the viewport so the rail stays put
        // while the main content scrolls.
        'hidden lg:flex flex-col shrink-0 h-dvh sticky top-0',
        'border-r border-[var(--border)]',
        collapsed ? 'w-[64px] py-3 px-2 items-center' : 'w-[280px] p-4',
      )}
      aria-label="Vizzor product navigation"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      {/* Brand row — collapse toggle on the right (or centered when
          collapsed). Mirrors LeftRail in predict-shell exactly. */}
      <div
        className={cn(
          'flex items-center mb-3',
          collapsed ? 'justify-center w-full' : 'justify-between',
        )}
      >
        {!collapsed && (
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
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? t('shell.openSidebar') : t('shell.collapseSidebar')}
          aria-pressed={!collapsed}
          className={cn(
            'inline-flex items-center justify-center rounded-lg',
            collapsed ? 'h-12 w-12' : 'h-10 w-10',
            'text-[var(--fg-2)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]',
            'transition-colors',
          )}
        >
          <IconSidebar collapsed={collapsed} size={collapsed ? 23 : 19} />
        </button>
      </div>

      {/* Primary nav. Matches the action contract of predict-shell's
          LeftRail exactly: New run → predict?action=new, Run →
          predict active thread, Alerts → in-place modal, Receipts →
          /account#payments. Icons jump to 20px in collapsed mode so
          the 64px gutter reads at a glance. */}
      <nav
        className={cn(
          'flex flex-col',
          collapsed ? 'gap-1 items-center w-full' : 'gap-0.5',
        )}
        aria-label="Surfaces"
      >
        <NavLink
          href="/app/predict?action=new"
          icon={<IconPlus size={collapsed ? 20 : 17} />}
          label={t('shell.newChat')}
          active={false}
          collapsed={collapsed}
        />
        <NavLink
          href="/app/predict"
          icon={<IconChat size={collapsed ? 20 : 17} />}
          label={t('shell.nav.chat')}
          active={onPredict}
          collapsed={collapsed}
        />
        <NavButton
          icon={<IconBell size={collapsed ? 20 : 17} />}
          label={t('shell.nav.alerts')}
          onClick={onOpenAlerts}
          collapsed={collapsed}
        />
        <NavLink
          href="/app/directory"
          icon={<Boxes size={collapsed ? 20 : 17} strokeWidth={1.6} />}
          label={t('shell.nav.directory')}
          active={/^\/app\/directory(\/|$)/.test(pathname)}
          collapsed={collapsed}
        />
        <NavButton
          icon={<IconReceipts size={collapsed ? 20 : 17} />}
          label={t('shell.nav.receipts')}
          onClick={onOpenReceipts}
          collapsed={collapsed}
        />
      </nav>

      {/* Recent chats — hidden in the collapsed gutter. Same SWR key
          the predict shell uses so the lists agree across surfaces.
          Each row deep-links into /app/predict?conversation=<id>. */}
      {!collapsed && (
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
      )}

      {/* Collapsed gutter — fill the empty space below the icon nav so
          the Identity pill stays anchored to the bottom of the rail. */}
      {collapsed && <div className="flex-1" aria-hidden />}

      {/* Identity dropdown — same composition the predict-shell uses
          (wallet header → subscription → network → actions). The
          richer version was upgraded in the previous pass; we render
          it here so both surfaces share the same dropdown. */}
      <div
        className={cn(
          'shrink-0 border-t border-[var(--border)] flex items-center',
          collapsed
            ? '-mx-2 px-2 py-3 justify-center'
            : '-mx-4 px-4 py-3 mt-2',
        )}
      >
        <Identity
          signedIn={signedIn}
          wallet={wallet}
          session={session}
          onOpenSettings={onOpenSettings}
          collapsed={collapsed}
        />
      </div>

    </aside>

      {/* In-place modals — mirror predict-shell. AlertsModal renders
          the same AlertsList the standalone surface uses; SettingsSheet
          owns theme + locale + clear-local-data. Mounted at sidebar
          level so any page on app.vizzor.ai can summon them without
          page navigation.

          MUST sit OUTSIDE the sticky `<aside>` above. `position: sticky`
          creates a stacking context, which traps the sheets' `fixed
          inset-0 z-[55]` at the rail's z-index — so the sheet renders
          BEHIND the main column instead of as a fullscreen overlay
          (the bug Zaid hit on /app/account where opening Settings
          revealed `TEMA` peeking out from behind the page). Hoisting
          the modals to a sibling fragment lets them paint at the
          document's stacking root. */}
      <AlertsModal open={alertsOpen} onClose={() => setAlertsOpen(false)} />
      {settingsOpen && (
        <SettingsSheet
          locale={locale}
          signedIn={signedIn}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}

function NavButton({
  icon,
  label,
  onClick,
  active = false,
  collapsed = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  collapsed?: boolean;
}) {
  const tonal = active
    ? 'bg-[var(--surface-2)] text-[var(--fg)] font-medium'
    : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]';
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        aria-label={label}
        title={label}
        className={cn(
          'group inline-flex items-center justify-center',
          'h-11 w-11 rounded-lg transition-colors',
          tonal,
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
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group w-full flex items-center gap-2.5 text-left',
        'px-3 py-2 rounded-md text-[13px] transition-colors',
        tonal,
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
    </button>
  );
}

function NavLink({
  href,
  icon,
  label,
  active,
  collapsed = false,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  active: boolean;
  collapsed?: boolean;
}) {
  const tonal = active
    ? 'bg-[var(--surface-2)] text-[var(--fg)] font-medium'
    : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]';
  if (collapsed) {
    return (
      <Link
        href={href as never}
        aria-current={active ? 'page' : undefined}
        aria-label={label}
        title={label}
        className={cn(
          'group inline-flex items-center justify-center',
          'h-11 w-11 rounded-lg transition-colors',
          tonal,
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
      </Link>
    );
  }
  return (
    <Link
      href={href as never}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group w-full flex items-center gap-2.5 text-left',
        'px-3 py-2 rounded-md text-[13px] transition-colors',
        tonal,
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
  onOpenSettings,
  collapsed = false,
}: {
  signedIn: boolean;
  wallet: string | undefined;
  session: SessionState | undefined;
  onOpenSettings: () => void;
  collapsed?: boolean;
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
        aria-label={`${short} menu`}
        title={collapsed ? `${short} · ${meta}` : undefined}
        className={cn(
          'w-full flex items-center gap-2.5 rounded-lg transition-colors',
          collapsed
            ? 'h-10 w-10 justify-center p-0'
            : 'px-2 py-2 text-left hover:bg-[var(--surface-2)]',
        )}
      >
        <span
          aria-hidden
          className="inline-flex h-8 w-8 items-center justify-center shrink-0 rounded-full bg-[var(--fg)] text-[var(--bg)] text-[12px] font-bold"
        >
          V
        </span>
        {!collapsed && (
          <span className="min-w-0 flex flex-col leading-tight flex-1 text-left">
            <span className="text-[12.5px] font-semibold text-[var(--fg)] truncate mono tabular">
              {short}
            </span>
            <span className="text-[11px] text-[var(--fg-3)] truncate">{meta}</span>
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-50 w-[min(280px,calc(100vw-24px))]',
            collapsed
              ? 'left-full ml-2 bottom-0'
              : 'left-0 bottom-full mb-2',
            'rounded-2xl border border-[var(--border)] bg-[var(--surface)]',
            'shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)]',
            'overflow-hidden',
          )}
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
            {/* Settings opens the same SettingsSheet predict-shell
                uses (theme + locale + clear-local-data) so the
                action mirrors the chat surface exactly. */}
            <MenuButton
              icon={<IconSettings size={15} />}
              label={t('settings')}
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            />
            {signedIn && (
              <MenuLink
                href="/app/account"
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

function MenuButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
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
    </button>
  );
}

/** IconSidebar — collapse/expand arrow inside a rounded-rect outline.
 *  Identical to the helper inside predict-shell's LeftRail so both
 *  rails carry the same affordance. */
function IconSidebar({
  collapsed,
  size = 15,
}: {
  collapsed: boolean;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2.5" y="3" width="11" height="10" rx="2" />
      <line x1="6" y1="3" x2="6" y2="13" />
      {collapsed ? (
        <path d="M9 6l2 2-2 2" />
      ) : (
        <path d="M11 6l-2 2 2 2" />
      )}
    </svg>
  );
}
