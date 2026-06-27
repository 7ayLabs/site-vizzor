'use client';

/**
 * MobileMenu — hamburger-triggered side drawer for screens below `md`.
 *
 * Visual contract: matches the navbar pill aesthetic. The panel
 * MATCHES the page mode — light surface in light mode, dark surface
 * in dark mode — so it reads as an elevated card from the page
 * surface rather than an inverted brand artifact. Primary CTAs
 * (Open App, Telegram) provide the contrast inside.
 *
 * Structure (top → bottom):
 *   1. Header strip: logo badge (small white circle) + close button
 *   2. Primary CTA pill: [Open App ↗] — paper-white solid, matching
 *      the desktop navbar's primary CTA
 *   3. Marketing nav rows: rounded-2xl pill rows for Manifesto,
 *      Pricing, Blog, Docs
 *   4. Footer:
 *      - Telegram outline pill (secondary CTA — Telegram is the #2
 *        product, kept reachable from mobile since the navbar pill
 *        only carries one primary action)
 *      - Preferences row (Language + Theme)
 *
 * Animations preserved: right-edge slide-in, backdrop fade,
 * row-stagger reveal, ESC dismiss, body scroll lock,
 * reduced-motion safe.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { TelegramIcon } from '@/components/icons/telegram-icon';
import { Link, usePathname } from '@/i18n/navigation';
import type { ComponentProps } from 'react';
import { LanguageSwitch } from './language-switch';
import { ThemeToggle } from './theme-toggle';
import { getAppLinkTarget } from '@/lib/app-url';

type LinkHref = ComponentProps<typeof Link>['href'];
type NavKey = 'manifesto' | 'pricing' | 'blog' | 'docs';

// Marketing nav for the drawer. Open App is promoted to its own
// primary pill above this list, so it's no longer in the loop here.
const NAV: readonly { href: LinkHref; key: NavKey; match: RegExp }[] = [
  { href: '/manifesto', key: 'manifesto', match: /^\/manifesto(\/|$)/ },
  { href: '/pricing', key: 'pricing', match: /^\/pricing(\/|$)/ },
  { href: '/blog', key: 'blog', match: /^\/blog(\/|$)/ },
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
          md:hidden inline-flex h-9 w-9 items-center justify-center
          rounded-full
          text-[var(--fg-3)]
          transition-[color,background-color,transform] duration-200 ease-out
          hover:text-[var(--fg)] hover:bg-[var(--surface-2)]
          active:scale-[0.94]
          focus-visible:outline-none focus-visible:ring-2
          focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2
          focus-visible:ring-offset-[var(--surface)]
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
          openAppLabel={t('openApp')}
          telegramLabel={t('cta')}
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
  openAppLabel: string;
  telegramLabel: string;
}

function MobilePanel({
  phase,
  onClose,
  nav,
  openAppLabel,
  telegramLabel,
}: PanelProps) {
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
      {/* Backdrop — deeper blur + opacity since the panel is dark; a
          lighter backdrop would let the page bleed through and break
          the brand-artifact feel. */}
      <button
        type="button"
        aria-label={t('mobileMenu.closeAria')}
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-[8px]"
      />

      <div
        className={`
          absolute right-0 top-0 z-10 h-full w-[min(360px,88vw)]
          rounded-l-3xl
          bg-[var(--surface)] text-[var(--fg)]
          border-l border-y border-[var(--border)]
          shadow-[-12px_0_48px_-16px_rgba(0,0,0,0.25)]
          dark:shadow-[-12px_0_48px_-10px_rgba(0,0,0,0.6)]
          flex flex-col overflow-hidden
          ${panelAnim}
        `}
      >
        {/* ── Header ─────────────────────────────────────────── */}
        <header className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--border)]">
          {/* Logo badge — one shade off the panel (--bg) so it reads
              as a small inset within the surface. Brand mark inside
              uses the dual-image theme swap. */}
          <span
            className="
              inline-flex items-center justify-center h-9 w-9
              rounded-full bg-[var(--bg)] border border-[var(--border)]
            "
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
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('mobileMenu.closeAria')}
            className="
              inline-flex h-9 w-9 items-center justify-center
              rounded-full
              text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]
              transition-colors
              focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2
              focus-visible:ring-offset-[var(--surface)]
            "
          >
            <X size={16} strokeWidth={2} />
          </button>
        </header>

        {/* ── Scrollable body ────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-4">
          {/* Primary CTA pill — paper-white solid, matches the desktop
              navbar's Open-App pill. Sits above the nav rows so it
              earns the primary visual weight inside the drawer. */}
          <OpenAppPrimary onClose={onClose} label={openAppLabel} />

          {/* Nav rows — rounded-2xl pills with subtle hover/active fill. */}
          <nav className="flex flex-col gap-1">
            {nav.map((item, i) => (
              <DrawerRow
                key={item.key}
                href={item.href}
                label={item.label}
                active={item.active}
                onClick={onClose}
                delayMs={90 + i * 30}
              />
            ))}
          </nav>
        </div>

        {/* ── Footer: secondary CTA + preferences ──────────── */}
        <div className="border-t border-[var(--border)] px-4 py-4 flex flex-col gap-4">
          {/* Telegram brand-blue pill — fixed brand color, doesn't
              flip with theme. */}
          <a
            href="https://t.me/vizzorai_bot"
            target="_blank"
            rel="noopener"
            onClick={onClose}
            className="
              inline-flex h-11 items-center justify-center gap-2 px-4
              rounded-full
              bg-[#229ED9] hover:bg-[#1B8FC4]
              text-white
              text-[13px] font-semibold tracking-tight
              transition-[background-color,transform] duration-200 ease-out
              active:scale-[0.98]
              focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-[#229ED9] focus-visible:ring-offset-2
              focus-visible:ring-offset-[var(--surface)]
            "
          >
            <TelegramIcon size={14} />
            <span>{telegramLabel}</span>
          </a>

          <div className="flex items-center justify-between gap-3">
            <span className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
              {t('mobileMenu.sections.preferences')}
            </span>
            {/* Pref triggers — drawer is now --surface, so the natural
                --fg-3 default of LanguageSwitch + ThemeToggle reads
                correctly without per-context overrides. */}
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

/**
 * Primary "Open App" pill at the top of the drawer body. Resolves the
 * URL + target via `getAppLinkTarget()` — external in prod (new tab),
 * internal locale-aware Link in dev.
 */
function OpenAppPrimary({
  onClose,
  label,
}: {
  onClose: () => void;
  label: string;
}) {
  const appLink = getAppLinkTarget();
  const classes = `
    mobile-drawer-row-in
    group inline-flex h-12 items-center justify-between
    rounded-full px-5
    bg-[var(--fg)] text-[var(--bg)]
    text-[14px] font-semibold tracking-tight
    transition-transform duration-200 ease-out
    active:scale-[0.98]
    focus-visible:outline-none focus-visible:ring-2
    focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2
    focus-visible:ring-offset-[var(--surface)]
  `;
  const content = (
    <>
      <span>{label}</span>
      <ArrowUpRight size={14} strokeWidth={2.25} />
    </>
  );
  const style = { ['--row-delay' as string]: '40ms' } as React.CSSProperties;

  if (appLink.external) {
    return (
      <a
        href={appLink.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${label} (opens in a new tab)`}
        onClick={onClose}
        style={style}
        className={classes}
      >
        {content}
      </a>
    );
  }
  return (
    <Link
      href={appLink.href as '/app/predict'}
      onClick={onClose}
      style={style}
      className={classes}
    >
      {content}
    </Link>
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
  // Use paper-white tones; active state is a subtle paper-fill so
  // active rows read without departing from the dark-pill palette.
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      style={{ ['--row-delay' as string]: `${delayMs}ms` }}
      className={`
        mobile-drawer-row-in
        group relative flex items-center justify-between
        rounded-2xl px-4 py-3
        text-[14px] transition-colors
        ${
          active
            ? 'bg-[var(--surface-2)] text-[var(--fg)] font-semibold'
            : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]'
        }
      `}
    >
      <span>{label}</span>
      <span
        aria-hidden
        className="
          mono tabular text-[11px] text-[var(--fg-3)]
          transition-transform duration-200 ease-out
          group-hover:translate-x-0.5
        "
      >
        →
      </span>
    </Link>
  );
}
