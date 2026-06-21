/**
 * Build a same-origin absolute URL with the correct locale prefix.
 * Used for wallet deeplink `redirect_link` params, which must be
 * fully qualified HTTPS URLs.
 *
 * Mirrors `i18n/routing.ts` (`defaultLocale: 'en'`, `localePrefix:
 * 'as-needed'`): the default locale gets no prefix, every other
 * locale is prefixed with `/<locale>`.
 */

import { routing } from '@/i18n/routing';

export function localizedPath(path: string, locale: string): string {
  if (locale === routing.defaultLocale) return path;
  return `/${locale}${path}`;
}

export function localizedAbsoluteUrl(path: string, locale: string): string {
  const origin =
    typeof window === 'undefined' ? 'https://vizzor.ai' : window.location.origin;
  return `${origin}${localizedPath(path, locale)}`;
}
