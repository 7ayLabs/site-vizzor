/**
 * i18n routing config — locale list, default locale, and prefix strategy.
 *
 * `localePrefix: 'as-needed'` means the default locale (English) lives at the
 * root (`/`, `/pricing`, etc.) while non-default locales get a prefix
 * (`/es/...`, `/fr/...`). All locale negotiation, language detection, and link
 * prefixing flow through this single object.
 */
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'es', 'fr'] as const,
  defaultLocale: 'en',
  localePrefix: 'as-needed',
});

export type Locale = (typeof routing.locales)[number];
