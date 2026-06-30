'use client';

/**
 * MobileAppNav — sticky topbar + slide-in drawer for `/app/*` surfaces
 * below the `lg` breakpoint.
 *
 * Why this exists:
 *   `ProductSidebar` (account + directory) and `AppSidebar` (whales,
 *   flow, alerts, billing, settings) both ship as `hidden lg:flex`,
 *   leaving mobile users with NO navigation chrome on those surfaces.
 *   Predict-shell carries its own mobile drawer; everything else
 *   relies on this component to surface the hamburger + drawer.
 *
 * Behavior:
 *   - Renders nothing on `/app/predict(/...)` — predict-shell owns its
 *     own mobile nav and stacking another bar would create a 2-deep
 *     top chrome on mobile.
 *   - Drawer mirrors the ProductSidebar nav contract: Nuevo / Predecir
 *     / Alertas / Directorio / Recibos + Recent chats list + Identity
 *     pill at the bottom. The user reaches every product surface from
 *     here without leaving the page they're on.
 *   - Backdrop click + Esc + nav-link click close the drawer.
 *
 * Visual contract follows the rest of the product chrome: tokens only
 * (--surface / --border / --fg-*), hairline borders, no shadows beyond
 * the drawer's own elevation.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Image from 'next/image';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { Menu, X } from 'lucide-react';
import { Boxes } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useConversations } from '@/components/predict/use-conversations';
import {
  IconBell,
  IconChat,
  IconPlus,
  IconReceipts,
} from '@/components/predict/predict-icons';

interface SessionState {
  ok?: boolean;
  signedIn?: boolean;
  wallet?: string;
}

const SUPPRESS_RE = /^\/(?:[a-z]{2}\/)?app\/predict(\/|$)/;

const fetcher = (url: string): Promise<SessionState> =>
  fetch(url, { credentials: 'same-origin' }).then((r) => r.json());

export function MobileAppNav() {
  const t = useTranslations('predict');
  const tMobile = useTranslations('app.mobileNav');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  // Identity + recent chats — pulled the same way ProductSidebar does
  // so the mobile drawer is data-identical to the desktop rail.
  const { data: session } = useSWR<SessionState>(
    '/api/auth/session',
    fetcher,
    { refreshInterval: 20_000, revalidateOnFocus: true, keepPreviousData: true },
  );
  const signedIn = !!session?.signedIn;
  const wallet = session?.wallet;
  const { conversations } = useConversations({ enabled: signedIn });
  const recent = useMemo(() => conversations.slice(0, 8), [conversations]);

  // Esc + body-scroll lock while the drawer is open. We unmount the
  // backdrop entirely when closed so it stops eating pointer events on
  // the page underneath.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Close the drawer on route change — no navigation event API in App
  // Router, so we watch the pathname and snap shut when it changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Predict owns its own mobile nav. Bailing here keeps the layout free
  // of a duplicate topbar on /app/predict.
  if (SUPPRESS_RE.test(pathname)) return null;

  const onPredictActive = /^\/(?:[a-z]{2}\/)?app\/predict(\/|$)/.test(pathname);
  const onDirectoryActive = /^\/(?:[a-z]{2}\/)?app\/directory(\/|$)/.test(pathname);
  const onAlertsActive = /^\/(?:[a-z]{2}\/)?app\/alerts(\/|$)/.test(pathname);
  const onAccountActive = /^\/(?:[a-z]{2}\/)?app\/account(\/|$)/.test(pathname);

  const short =
    signedIn && wallet
      ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}`
      : tMobile('connectWallet');

  return (
    <>
      {/* Sticky topbar — only renders below lg. The desktop rails take
          over at lg+ so this bar would just shadow them. */}
      <header
        className={cn(
          'lg:hidden sticky top-0 z-30',
          'flex items-center justify-between gap-3',
          'h-12 px-4',
          'border-b border-[var(--border)]',
          'bg-[color-mix(in_oklab,var(--bg)_92%,transparent)] backdrop-blur-md',
        )}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={tMobile('openMenu')}
          aria-expanded={open}
          aria-controls="mobile-app-drawer"
          className="inline-flex items-center justify-center h-9 w-9 -ml-2 rounded-md text-[var(--fg-2)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors"
        >
          <Menu size={18} strokeWidth={1.75} aria-hidden />
        </button>

        <Link
          href="/app/predict"
          aria-label={tMobile('home')}
          className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-[var(--fg)] hover:opacity-80 transition-opacity"
        >
          <Image
            src="/brand/vizzor_darkicon.png"
            alt=""
            width={364}
            height={535}
            priority
            className="block dark:hidden h-5 w-auto"
          />
          <Image
            src="/brand/vizzor_icon.png"
            alt=""
            width={364}
            height={535}
            priority
            className="hidden dark:block h-5 w-auto"
          />
          <span>vizzor</span>
        </Link>

        <span
          className="mono tabular text-[10.5px] uppercase tracking-[0.14em] text-[var(--fg-3)] truncate max-w-[6rem]"
          title={wallet}
        >
          {short}
        </span>
      </header>

      {/* Drawer + backdrop. Mounted at document root via z-50 so the
          fixed overlay sits above any sticky chrome on the page. */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50">
          <button
            type="button"
            aria-label={tMobile('closeMenu')}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          <div
            id="mobile-app-drawer"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={tMobile('navLabel')}
            className={cn(
              'absolute left-0 top-0 h-dvh w-[min(320px,84vw)]',
              'flex flex-col',
              'border-r border-[var(--border)]',
              'bg-[var(--surface)]',
              'motion-safe:animate-[mn-slide-in_180ms_ease-out]',
            )}
          >
            <style>{`
              @keyframes mn-slide-in {
                from { transform: translateX(-100%); }
                to   { transform: translateX(0); }
              }
            `}</style>

            {/* Drawer header — close button + brand */}
            <div className="flex items-center justify-between gap-2 px-4 h-12 border-b border-[var(--border)]">
              <Link
                href="/app/predict"
                onClick={() => setOpen(false)}
                aria-label={tMobile('home')}
                className="inline-flex items-center gap-2 text-[15px] font-semibold tracking-tight text-[var(--fg)]"
              >
                <Image
                  src="/brand/vizzor_darkicon.png"
                  alt=""
                  width={364}
                  height={535}
                  priority
                  className="block dark:hidden h-5 w-auto"
                />
                <Image
                  src="/brand/vizzor_icon.png"
                  alt=""
                  width={364}
                  height={535}
                  priority
                  className="hidden dark:block h-5 w-auto"
                />
                <span>vizzor</span>
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={tMobile('closeMenu')}
                className="inline-flex items-center justify-center h-9 w-9 -mr-2 rounded-md text-[var(--fg-2)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors"
              >
                <X size={18} strokeWidth={1.75} aria-hidden />
              </button>
            </div>

            {/* Primary nav — mirrors ProductSidebar's vocabulary */}
            <nav
              className="px-2 py-3 flex flex-col gap-0.5"
              aria-label={tMobile('navLabel')}
            >
              <DrawerLink
                href="/app/predict?action=new"
                icon={<IconPlus size={17} />}
                label={t('shell.newChat')}
                active={false}
              />
              <DrawerLink
                href="/app/predict"
                icon={<IconChat size={17} />}
                label={t('shell.nav.chat')}
                active={onPredictActive}
              />
              <DrawerLink
                href="/app/alerts"
                icon={<IconBell size={17} />}
                label={t('shell.nav.alerts')}
                active={onAlertsActive}
              />
              <DrawerLink
                href="/app/directory"
                icon={<Boxes size={17} strokeWidth={1.6} />}
                label={t('shell.nav.directory')}
                active={onDirectoryActive}
              />
              <DrawerLink
                href="/app/account#payments"
                icon={<IconReceipts size={17} />}
                label={t('shell.nav.receipts')}
                active={onAccountActive}
              />
            </nav>

            {/* Recent chats — mirrors the desktop rail. Hidden cleanly
                when the user is not signed in. */}
            {signedIn && recent.length > 0 && (
              <div className="px-2 pt-2 flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 border-t border-[var(--border)]">
                <p className="px-3 pt-2 text-[10.5px] uppercase tracking-[0.16em] text-[var(--fg-3)] font-semibold">
                  {t('shell.recents.label')}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {recent.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/app/predict?conversation=${encodeURIComponent(c.id)}` as never}
                        className="block px-3 py-1.5 rounded-md text-[12.5px] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] truncate transition-colors"
                        title={c.title}
                      >
                        {c.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Identity row — kept minimal on mobile (just the wallet
                short address). Full account actions live behind a tap
                on the row, which routes to /app/account. */}
            <div className="mt-auto px-2 py-3 border-t border-[var(--border)]">
              <Link
                href="/app/account"
                className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-[var(--surface-2)] transition-colors"
              >
                <span
                  aria-hidden
                  className="inline-flex h-8 w-8 items-center justify-center shrink-0 rounded-full bg-[var(--fg)] text-[var(--bg)] text-[12px] font-bold"
                >
                  V
                </span>
                <span className="flex flex-col leading-tight min-w-0">
                  <span className="text-[12.5px] font-semibold text-[var(--fg)] truncate mono tabular">
                    {short}
                  </span>
                  <span className="text-[11px] text-[var(--fg-3)] truncate">
                    {signedIn ? t('shell.identityConnected') : t('shell.identityMeta')}
                  </span>
                </span>
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DrawerLink({
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
        'group flex items-center gap-2.5 rounded-md px-3 py-2.5 text-[13.5px] transition-colors',
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
