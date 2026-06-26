'use client';

/**
 * LanguageSwitch — discreet locale picker for header / footer use.
 *
 * Renders an icon + locale abbreviation button (e.g. `EN ▾`). Click opens a
 * tiny dropdown with the three supported locales; the active locale shows a
 * check. Selection swaps locales via `useRouter().replace` so the URL prefix
 * updates without losing the current path or query string.
 *
 * `placement` controls dropdown direction — default `down` for nav contexts,
 * `up` when the switch lives near a page bottom (the footer) so the menu
 * doesn't drop off the viewport edge.
 *
 * Keyboard model:
 *  - Tab / Shift-Tab: standard focus traversal in/out
 *  - Enter / Space: toggle the menu
 *  - Esc: close the menu and refocus the trigger
 *  - ArrowDown / ArrowUp: cycle options
 *  - Enter on an option: switch + close
 *
 * Outside clicks close the menu via a document-level pointerdown listener
 * scoped to when the menu is open.
 */

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Languages, Check, ChevronDown } from 'lucide-react';
import { useRouter, usePathname } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { cn } from '@/lib/utils';

const LOCALE_ABBR: Record<Locale, string> = {
  en: 'EN',
  es: 'ES',
  fr: 'FR',
};

export function LanguageSwitch({
  placement = 'down',
}: {
  placement?: 'down' | 'up';
} = {}) {
  const t = useTranslations('languageSwitch');
  const router = useRouter();
  const pathname = usePathname();
  const active = useLocale() as Locale;

  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<number>(() =>
    Math.max(0, routing.locales.indexOf(active)),
  );

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Reset highlight to the active locale every time we open.
  useEffect(() => {
    if (open) {
      setHighlight(Math.max(0, routing.locales.indexOf(active)));
    }
  }, [open, active]);

  // Focus the highlighted option for keyboard nav.
  useEffect(() => {
    if (!open) return;
    optionRefs.current[highlight]?.focus();
  }, [open, highlight]);

  // Outside-click + Esc handling.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        menuRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function selectLocale(next: Locale) {
    setOpen(false);
    if (next === active) {
      triggerRef.current?.focus();
      return;
    }
    router.replace(pathname, { locale: next });
  }

  function onTriggerKey(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  }

  function onMenuKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((i) => (i + 1) % routing.locales.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight(
        (i) => (i - 1 + routing.locales.length) % routing.locales.length,
      );
    } else if (event.key === 'Home') {
      event.preventDefault();
      setHighlight(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setHighlight(routing.locales.length - 1);
    }
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('label')}
        className={cn(
          'group inline-flex h-8 items-center gap-1.5',
          'text-[var(--pref-trigger,var(--fg-3))]',
          'transition-[color,transform] duration-200 ease-out',
          'hover:text-[var(--pref-trigger-hover,var(--fg))] hover:scale-[1.04]',
          'active:scale-[0.96]',
          'focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-[var(--accent)] focus-visible:rounded-md',
        )}
      >
        <Languages size={15} strokeWidth={1.6} aria-hidden />
        <span className="mono tabular text-[11px] font-semibold tracking-[0.08em]">
          {LOCALE_ABBR[active]}
        </span>
        <ChevronDown
          size={11}
          strokeWidth={1.75}
          aria-hidden
          className={cn(
            'transition-transform duration-200 ease-out',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('label')}
          onKeyDown={onMenuKey}
          className={cn(
            'absolute right-0 z-50 min-w-[180px]',
            placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2',
            'rounded-xl border border-[var(--border)] bg-[var(--surface)]',
            'shadow-[0_8px_24px_-12px_color-mix(in_oklab,var(--fg)_25%,transparent)]',
            'p-1',
            // Subtle pop-in so the dropdown feels anchored to the
            // trigger, not floating in from nowhere.
            'motion-safe:animate-[locale-menu-in_180ms_cubic-bezier(0.16,1,0.3,1)_both]',
          )}
        >
          {routing.locales.map((locale, index) => {
            const isActive = locale === active;
            return (
              <button
                key={locale}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                role="menuitemradio"
                aria-checked={isActive}
                type="button"
                onClick={() => selectLocale(locale)}
                onMouseEnter={() => setHighlight(index)}
                className={cn(
                  'flex w-full items-center justify-between gap-3',
                  'rounded-lg px-3 py-2 text-left',
                  'text-[13px] text-[var(--fg-2)]',
                  'transition-colors duration-100',
                  'hover:bg-[var(--surface-2)] hover:text-[var(--fg)]',
                  'focus:outline-none focus:bg-[var(--surface-2)] focus:text-[var(--fg)]',
                  isActive && 'text-[var(--fg)]',
                )}
              >
                <span className="flex flex-col leading-tight">
                  <span className="font-semibold">{t(`options.${locale}`)}</span>
                  <span className="mono tabular text-[10px] tracking-[0.12em] text-[var(--fg-3)]">
                    {LOCALE_ABBR[locale]}
                  </span>
                </span>
                <Check
                  size={14}
                  strokeWidth={2}
                  aria-hidden
                  className={cn(
                    'text-[var(--accent)] transition-opacity duration-100',
                    isActive ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
