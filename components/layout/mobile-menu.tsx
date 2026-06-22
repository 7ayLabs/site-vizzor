'use client';

/**
 * MobileMenu — hamburger-triggered side drawer for screens below `md`.
 *
 * Visual contract:
 *   - Right-anchored panel, `min(360px, 88vw)` wide.
 *   - Docs-sidebar typography vocabulary: mono uppercase section eyebrows,
 *     13.5px row text, 8px row radius, left-edge 2px bar on active rows.
 *   - Sections (in order): Navigate, Account, Preferences. Each section
 *     gets its own dedicated eyebrow so the drawer reads like an atlas
 *     instead of a flat link dump.
 *   - Smooth right-edge slide via `mobile-drawer-slide-in/out` (defined
 *     in app/globals.css), staggered row reveal on first paint.
 *   - Backdrop click + Escape dismiss, focus returns to the hamburger,
 *     body scroll locked while open, reduced-motion respected.
 *
 * The wallet entry lives inside the Account section. It reuses the
 * existing `WalletAuthButton hasProvider={false}` so the connect /
 * sign-in / signed-in states stay in lock-step with the navbar.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Menu, X } from 'lucide-react';
import { TelegramIcon } from '@/components/icons/telegram-icon';
import { Link, usePathname } from '@/i18n/navigation';
import type { ComponentProps } from 'react';
import type { Route } from 'next';
import { LanguageSwitch } from './language-switch';
import { ThemeToggle } from './theme-toggle';
import { WalletAuthButton } from '@/components/auth/wallet-auth-button';

type LinkHref = ComponentProps<typeof Link>['href'];
type NavKey = 'predict' | 'surfaces' | 'pricing' | 'docs';

const NAV: readonly { href: LinkHref; key: NavKey; match: RegExp }[] = [
  { href: '/predict', key: 'predict', match: /^\/predict(\/|$)/ },
  {
    href: '/docs#surfaces' as Route,
    key: 'surfaces',
    match: /^\/docs#surfaces/,
  },
  { href: '/pricing', key: 'pricing', match: /^\/pricing(\/|$)/ },
  { href: '/docs', key: 'docs', match: /^\/docs($|\/)/ },
];

type Phase = 'closed' | 'opening' | 'open' | 'closing';
const EXIT_MS = 220;

export function MobileMenu() {
  const t = useTranslations('header');
  const tNav = useTranslations('header.nav');
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<Phase>('closed');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const open = (): void => {
    setPhase((p) => (p === 'closed' || p === 'closing' ? 'opening' : p));
    requestAnimationFrame(() => setPhase((p) => (p === 'opening' ? 'open' : p)));
  };
  const close = (): void => {
    setPhase((p) => (p === 'closed' ? p : 'closing'));
    window.setTimeout(() => setPhase('closed'), EXIT_MS);
    window.setTimeout(() => triggerRef.current?.focus(), EXIT_MS + 50);
  };

  // Escape key + body scroll lock while visible.
  useEffect(() => {
    if (phase === 'closed') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [phase]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        aria-expanded={phase === 'open' || phase === 'opening'}
        aria-label={t('mobileMenu.openAria')}
        className="
          md:hidden inline-flex h-8 w-8 items-center justify-center
          text-[var(--fg-3)]
          transition-[color,transform] duration-200 ease-out
          hover:text-[var(--fg)] hover:scale-[1.06]
          active:scale-[0.94]
          focus-visible:outline-none focus-visible:ring-2
          focus-visible:ring-[var(--accent)] focus-visible:rounded-md
        "
      >
        <Menu size={18} strokeWidth={1.75} />
      </button>

      {mounted && phase !== 'closed' && (
        <MobilePanel
          phase={phase}
          onClose={close}
          nav={NAV.map((item) => ({
            ...item,
            label: tNav(item.key),
            active: item.match.test(pathname),
          }))}
          cta={t('cta')}
        />
      )}
    </>
  );
}

/* ─────────────── panel ─────────────── */

interface PanelProps {
  phase: Phase;
  onClose: () => void;
  nav: Array<{
    href: LinkHref;
    key: NavKey;
    label: string;
    active: boolean;
  }>;
  cta: string;
}

function MobilePanel({ phase, onClose, nav, cta }: PanelProps) {
  const t = useTranslations('header');
  const exiting = phase === 'closing';
  const backdropAnim = exiting
    ? 'motion-safe:mobile-drawer-fade-out'
    : 'motion-safe:mobile-drawer-fade-in';
  const panelAnim = exiting
    ? 'motion-safe:mobile-drawer-slide-out'
    : 'motion-safe:mobile-drawer-slide-in';

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('mobileMenu.label')}
      className={`fixed inset-0 z-[70] md:hidden ${backdropAnim}`}
    >
      <button
        type="button"
        aria-label={t('mobileMenu.closeAria')}
        onClick={onClose}
        className="absolute inset-0 bg-[color:color-mix(in_oklab,var(--bg)_70%,black_20%)]/85 backdrop-blur-[6px]"
      />

      <div
        className={`
          absolute right-0 top-0 z-10 h-full w-[min(360px,88vw)]
          border-l border-[var(--border)] bg-[var(--surface)]
          flex flex-col ${panelAnim}
        `}
      >
        {/* ── Header ─────────────────────────────────────────── */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <span className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
            {t('mobileMenu.eyebrow')}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('mobileMenu.closeAria')}
            className="
              inline-flex h-8 w-8 items-center justify-center rounded-md
              text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]
              transition-colors
              focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-[var(--accent)]
            "
          >
            <X size={16} strokeWidth={2} />
          </button>
        </header>

        {/* ── Scrollable body ────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-5">
          {/* Navigate section */}
          <SectionEyebrow label={t('mobileMenu.sections.navigate')} />
          <nav className="flex flex-col gap-0.5">
            {nav.map((item, i) => (
              <DrawerRow
                key={item.key}
                href={item.href}
                label={item.label}
                active={item.active}
                onClick={onClose}
                delayMs={40 + i * 25}
              />
            ))}
          </nav>

          {/* Account section */}
          <SectionEyebrow label={t('mobileMenu.sections.account')} />
          <div
            className="mobile-drawer-row-in px-1"
            style={{ ['--row-delay' as string]: `${40 + nav.length * 25 + 30}ms` }}
          >
            <WalletAuthButton hasProvider={false} />
          </div>
        </div>

        {/* ── Footer: CTA + preferences ──────────────────────── */}
        <div className="border-t border-[var(--border)] px-5 py-4 flex flex-col gap-3">
          <a
            href="https://t.me/vizzorai_bot"
            target="_blank"
            rel="noopener"
            onClick={onClose}
            className="
              inline-flex h-11 items-center justify-center gap-2 px-4
              rounded-full bg-[var(--fg)] text-[var(--bg)]
              text-[13px] font-semibold tracking-tight
              hover:opacity-90 transition-opacity
            "
          >
            <span>{cta}</span>
            <TelegramIcon size={14} />
          </a>

          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
              {t('mobileMenu.sections.preferences')}
            </span>
            <div className="flex items-center gap-2">
              {/* placement='up' so the locale menu opens above the
                  switch instead of dropping off the drawer footer. */}
              <LanguageSwitch placement="up" />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─────────────── pieces ─────────────── */

function SectionEyebrow({ label }: { label: string }) {
  return (
    <p className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-3)] px-2.5 -mb-1">
      {label}
    </p>
  );
}

function DrawerRow({
  href,
  label,
  active,
  onClick,
  delayMs,
}: {
  href: LinkHref;
  label: string;
  active: boolean;
  onClick: () => void;
  delayMs: number;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      style={{ ['--row-delay' as string]: `${delayMs}ms` }}
      className={`
        mobile-drawer-row-in
        relative flex items-center justify-between
        rounded-lg px-2.5 py-2
        text-[13.5px] transition-colors
        ${
          active
            ? 'bg-[var(--surface-2)] text-[var(--fg)] font-semibold'
            : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]'
        }
      `}
    >
      {/* Left-edge active bar — mirrors the docs sidebar treatment. */}
      {active && (
        <span
          aria-hidden
          className="absolute left-[-2px] top-[30%] bottom-[30%] w-[2px] rounded-sm bg-[var(--fg)]"
        />
      )}
      <span>{label}</span>
      <span
        aria-hidden
        className="mono tabular text-[10.5px] text-[var(--fg-3)]"
      >
        →
      </span>
    </Link>
  );
}
