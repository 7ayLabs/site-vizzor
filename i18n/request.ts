/**
 * Server-side request config — resolves the active locale per request and
 * lazy-loads the matching messages bundle. Picked up automatically by the
 * next-intl plugin wired in `next.config.ts`.
 */
import { getRequestConfig } from 'next-intl/server';
import { routing, type Locale } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale =
    requested && routing.locales.includes(requested as Locale)
      ? (requested as Locale)
      : routing.defaultLocale;

  const messages = (await import(`../messages/${locale}.json`)).default;
  return {
    locale,
    messages,
  };
});
