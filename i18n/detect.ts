/**
 * Geo-based locale detection.
 *
 * Vercel and Cloudflare both forward a 2-letter ISO-3166 country code on
 * every request (`x-vercel-ip-country` / `cf-ipcountry`). When the
 * visitor hits the site for the first time with no locale prefix in the
 * URL AND no `NEXT_LOCALE` cookie set, we map the country to one of the
 * supported site locales so the chrome lands in the right language
 * before next-intl falls back to the Accept-Language heuristic.
 *
 * Mapping policy (per product spec):
 *   - Latin America + Spain → `es` (the es.json content is LATAM-flavoured;
 *     Spain users still get LATAM Spanish — accept the tradeoff while we
 *     have a single `es` locale).
 *   - France-speaking core (FR, BE, LU, MC) → `fr`. Quebec lives under
 *     CA → handled below.
 *   - Everything else, including the US → `en` (US English is the
 *     canonical English variant our content uses).
 *
 * `null` return = "no hint available, let next-intl negotiate normally
 * via Accept-Language". Callers should treat it that way.
 */

import type { Locale } from './routing';

const LATAM_ES: ReadonlySet<string> = new Set([
  'AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'GT', 'HN',
  'MX', 'NI', 'PA', 'PE', 'PR', 'PY', 'SV', 'UY', 'VE',
  // Equatorial Guinea is Spanish-speaking, included for completeness.
  'GQ',
  // Spain — collapsed to `es` since we only ship one es bundle.
  'ES',
]);

const FRANCOPHONE_CORE: ReadonlySet<string> = new Set([
  'FR', 'BE', 'LU', 'MC',
]);

/**
 * Map a 2-letter ISO-3166 country code to one of the routing locales, or
 * return `null` if no opinion. Lower-case input is normalised internally.
 */
export function localeForCountry(country: string | null | undefined): Locale | null {
  if (!country) return null;
  const cc = country.trim().toUpperCase().slice(0, 2);
  if (cc.length !== 2) return null;
  if (LATAM_ES.has(cc)) return 'es';
  if (FRANCOPHONE_CORE.has(cc)) return 'fr';
  if (cc === 'US') return 'en';
  // Everything else (UK, AU, DE, NL, ...) → en. Default English is what
  // we ship today; locale opt-in still works via the URL prefix or the
  // language switcher.
  return 'en';
}

/**
 * Read a country code from the typical edge headers. Vercel comes first
 * because production runs on Vercel; Cloudflare is the secondary case
 * (e.g. when the site sits behind a CF proxy in front of Vercel).
 */
export function readEdgeCountry(headers: Headers): string | null {
  const v = headers.get('x-vercel-ip-country');
  if (v && v.length > 0) return v;
  const cf = headers.get('cf-ipcountry');
  if (cf && cf.length > 0) return cf;
  return null;
}
