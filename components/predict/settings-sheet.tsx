'use client';

/**
 * SettingsSheet — small popup launched from the Identity dropdown's
 * "Settings" item on /predict. Three controls, no scroll:
 *
 *   1. Theme   — light / dark / system, reuses `useTheme`.
 *   2. Locale  — en / es / fr, swaps the current pathname via
 *                next-intl's locale-aware router so the user stays on
 *                /predict but in the new language.
 *   3. Clear local data — drops every `vizzor.*` key from
 *                localStorage + sessionStorage (sidebar collapse,
 *                wallet handoff, theme). Useful for QA + a
 *                privacy-conscious user reset.
 *
 * Esc + backdrop close. Renders nothing visually until `open` flips
 * to true at the parent.
 */

import { useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { useTheme } from '@/components/layout/theme-provider';
import { cn } from '@/lib/utils';
import { IconClose } from './predict-icons';

export interface SettingsSheetProps {
  locale: string;
  signedIn: boolean;
  onClose: () => void;
}

const LOCALE_LABEL: Record<string, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
};

export function SettingsSheet({ locale, signedIn, onClose }: SettingsSheetProps) {
  const t = useTranslations('predict.settings');
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onPickLocale = useCallback(
    (next: string): void => {
      if (next === locale) {
        onClose();
        return;
      }
      router.replace(pathname, { locale: next as 'en' | 'es' | 'fr' });
      onClose();
    },
    [router, pathname, locale, onClose],
  );

  const onClearLocal = useCallback((): void => {
    if (typeof window === 'undefined') return;
    const drop = (storage: Storage): void => {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith('vizzor')) keys.push(k);
      }
      keys.forEach((k) => storage.removeItem(k));
    };
    drop(window.localStorage);
    drop(window.sessionStorage);
    onClose();
  }, [onClose]);

  const onSignOut = useCallback(async (): Promise<void> => {
    try {
      await fetch('/api/auth/session', {
        method: 'DELETE',
        credentials: 'same-origin',
      });
    } finally {
      window.location.reload();
    }
  }, []);

  return (
    <div
      className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
    >
      <button
        type="button"
        aria-label={t('close')}
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
      />
      <div
        className={cn(
          'relative z-10 w-full sm:max-w-[380px]',
          'rounded-t-2xl sm:rounded-2xl border border-[var(--border)] bg-[var(--surface)]',
          'shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)]',
          'flex flex-col',
        )}
      >
        <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div className="flex flex-col gap-1.5 min-w-0">
            <span className="mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
              {t('eyebrow')}
            </span>
            <h2 className="text-[16px] font-semibold tracking-tight text-[var(--fg)] truncate">
              {t('title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="-mr-1 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors"
          >
            <IconClose size={14} />
          </button>
        </header>

        <div className="px-5 pb-5 flex flex-col gap-5">
          {/* Theme */}
          <section className="flex flex-col gap-2">
            <h3 className="mono tabular text-[10.5px] uppercase tracking-[0.16em] text-[var(--fg-3)] font-semibold">
              {t('theme.label')}
            </h3>
            <div className="grid grid-cols-3 gap-1.5">
              {(['light', 'dark', 'system'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setTheme(opt)}
                  aria-pressed={theme === opt}
                  className={cn(
                    'h-9 rounded-md text-[12px] font-medium transition-colors',
                    theme === opt
                      ? 'bg-[var(--fg)] text-[var(--bg)]'
                      : 'border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]',
                  )}
                >
                  {t(`theme.${opt}` as 'theme.light')}
                </button>
              ))}
            </div>
          </section>

          {/* Language */}
          <section className="flex flex-col gap-2">
            <h3 className="mono tabular text-[10.5px] uppercase tracking-[0.16em] text-[var(--fg-3)] font-semibold">
              {t('language.label')}
            </h3>
            <div className="grid grid-cols-3 gap-1.5">
              {routing.locales.map((loc) => (
                <button
                  key={loc}
                  type="button"
                  onClick={() => onPickLocale(loc)}
                  aria-pressed={loc === locale}
                  className={cn(
                    'h-9 rounded-md text-[12px] font-medium transition-colors',
                    loc === locale
                      ? 'bg-[var(--fg)] text-[var(--bg)]'
                      : 'border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]',
                  )}
                >
                  {LOCALE_LABEL[loc] ?? loc}
                </button>
              ))}
            </div>
          </section>

          {/* Privacy actions */}
          <section className="flex flex-col gap-2">
            <h3 className="mono tabular text-[10.5px] uppercase tracking-[0.16em] text-[var(--fg-3)] font-semibold">
              {t('privacy.label')}
            </h3>
            <button
              type="button"
              onClick={onClearLocal}
              className="h-9 rounded-md border border-[var(--border)] text-[12px] font-medium text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors"
            >
              {t('privacy.clearLocal')}
            </button>
            {signedIn && (
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="h-9 rounded-md border border-[var(--border)] text-[12px] font-medium text-[color:var(--danger)] hover:bg-[var(--surface-2)] transition-colors"
              >
                {t('privacy.signOut')}
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
