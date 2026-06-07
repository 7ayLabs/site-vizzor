'use client';

/**
 * MobileMenu — hamburger-triggered slide-in panel for screens below
 * the `md` breakpoint.
 *
 * The desktop top bar exposes Predict / Surfaces / Pricing / Docs as
 * inline pills, plus the language switch, theme toggle, and Telegram
 * CTA — all of which are `hidden md:flex` for space. On mobile, the
 * hamburger here is the single entry point to all of those.
 *
 * Behavior:
 *   - Slides in from the right with a backdrop blur.
 *   - Backdrop click and Escape dismiss.
 *   - Body scroll-locked while open.
 *   - Focus returns to the hamburger when the menu closes.
 *   - Selecting any nav item auto-dismisses so the user lands on the
 *     destination cleanly.
 *
 * The Telegram CTA, language switch, and theme toggle are duplicated
 * here from the desktop bar so mobile users get parity without
 * navigating to a separate settings surface.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Menu, X, ArrowUpRight } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import type { ComponentProps } from 'react';
import type { Route } from 'next';
import { LanguageSwitch } from './language-switch';
import { ThemeToggle } from './theme-toggle';

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
const EXIT_MS = 200;

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

  // Phase machine — opening/closing intermediate states drive
  // animation, the open/closed states drive interactivity.
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
          rounded-md border border-[var(--border)] bg-[var(--surface)]
          text-[var(--fg)]
          hover:bg-[var(--surface-2)] transition-colors
        "
      >
        <Menu size={16} strokeWidth={2} />
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
    ? 'motion-safe:wallet-modal-fade-out'
    : 'motion-safe:wallet-modal-fade-in';
  const panelAnim = exiting
    ? 'motion-safe:wallet-modal-slide-out'
    : 'motion-safe:wallet-modal-slide-in';

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
        className="absolute inset-0 bg-[color:color-mix(in_oklab,var(--bg)_70%,black_20%)]/80 backdrop-blur-sm"
      />

      <div
        className={`
          absolute right-0 top-0 z-10 h-full w-[min(360px,88vw)]
          border-l border-[var(--border)] bg-[var(--surface)]
          flex flex-col ${panelAnim}
        `}
      >
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
            "
          >
            <X size={16} strokeWidth={2} />
          </button>
        </header>

        <nav className="flex flex-col px-3 py-3 gap-0.5">
          {nav.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              onClick={onClose}
              aria-current={item.active ? 'page' : undefined}
              className={`
                inline-flex items-center justify-between px-3 py-3 rounded-lg
                text-[15px] font-medium transition-colors
                ${
                  item.active
                    ? 'bg-[var(--surface-2)] text-[var(--fg)]'
                    : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]'
                }
              `}
            >
              <span>{item.label}</span>
              <span
                aria-hidden
                className="mono tabular text-[11px] text-[var(--fg-3)]"
              >
                →
              </span>
            </Link>
          ))}
        </nav>

        <div className="mt-auto border-t border-[var(--border)] px-5 py-4 flex flex-col gap-3">
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
            <ArrowUpRight size={14} strokeWidth={2.2} />
          </a>

          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
              {t('mobileMenu.settings')}
            </span>
            <div className="flex items-center gap-2">
              <LanguageSwitch />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
