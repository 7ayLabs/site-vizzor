/**
 * Display-only currency conversion.
 *
 * Vizzor charges in USD-denominated crypto (SOL / TON) — the actual
 * on-chain transfer is sized from the live USD rate at session create
 * time. USD is the source of truth for every price in the system.
 *
 * This module adds a **purely cosmetic** local-currency hint next to
 * the USD price so a visitor from São Paulo doesn't have to do mental
 * math. The hint reads "~R$95" next to the canonical "$19" and the
 * crypto amount (~0.18 SOL) is unaffected.
 *
 * Rate source: a small static table of approximate USD→fiat factors
 * (`STATIC_FX_RATES` below). We DON'T fetch a live forex rate because:
 *   - The displayed value is non-authoritative; a 2 % drift on the
 *     EUR/USD rate doesn't affect what the user actually pays.
 *   - Adding a forex provider widens the supply chain + introduces
 *     another 503 surface to defend against.
 *   - The cosmetic hint is gated by `prefersLocalCurrency()`, so users
 *     who want exact USD figures can read the canonical price unchanged.
 *
 * To upgrade to live rates later: replace `usdToLocal` with a SWR-backed
 * fetch against /api/currency/fiat-rate or similar; keep the same
 * signature and the call sites here won't change.
 */

import type { Locale } from '@/i18n/routing';

/**
 * Currency code for each shipping locale. en defaults to USD; es is
 * collapsed to USD too because LATAM has too many currencies to pick
 * one without geo data — the hint shows only when geoCountry resolves
 * a more specific currency.
 */
const LOCALE_DEFAULT_CURRENCY: Record<Locale, string> = {
  en: 'USD',
  es: 'USD',
  fr: 'EUR',
};

/**
 * Country → currency map for the geo-aware hint. Only countries with a
 * meaningful conversion (purchasing-power gap or different symbol) are
 * listed; US/CA-en/AU all read in USD as the default UX.
 */
const COUNTRY_CURRENCY: ReadonlyMap<string, string> = new Map([
  // EUR zone
  ['DE', 'EUR'], ['FR', 'EUR'], ['IT', 'EUR'], ['ES', 'EUR'],
  ['NL', 'EUR'], ['PT', 'EUR'], ['BE', 'EUR'], ['AT', 'EUR'],
  ['IE', 'EUR'], ['FI', 'EUR'], ['LU', 'EUR'], ['GR', 'EUR'],
  ['SK', 'EUR'], ['SI', 'EUR'], ['EE', 'EUR'], ['LV', 'EUR'],
  ['LT', 'EUR'], ['CY', 'EUR'], ['MT', 'EUR'], ['MC', 'EUR'],
  // GBP
  ['GB', 'GBP'],
  // LATAM
  ['MX', 'MXN'], ['BR', 'BRL'], ['AR', 'ARS'], ['CL', 'CLP'],
  ['CO', 'COP'], ['PE', 'PEN'], ['UY', 'UYU'],
  // Asia-Pacific
  ['JP', 'JPY'], ['KR', 'KRW'], ['SG', 'SGD'], ['HK', 'HKD'],
  ['TW', 'TWD'], ['IN', 'INR'], ['ID', 'IDR'], ['TH', 'THB'],
  ['VN', 'VND'], ['PH', 'PHP'], ['MY', 'MYR'],
  // CHF / NOR / SWE / DNK
  ['CH', 'CHF'], ['NO', 'NOK'], ['SE', 'SEK'], ['DK', 'DKK'],
  // Others
  ['ZA', 'ZAR'], ['TR', 'TRY'], ['AE', 'AED'], ['IL', 'ILS'],
  ['RU', 'RUB'], ['UA', 'UAH'], ['NG', 'NGN'], ['EG', 'EGP'],
  // Always-USD jurisdictions stay USD by omission (US, CA-en, AU,
  // NZ, etc.) — the hint won't render for them, which is the correct
  // UX (no point showing "$19 ~ $19").
]);

/**
 * Approximate USD → local factor. Maintained quarterly; numbers within
 * ±10 % of the real spot rate are good enough for a cosmetic hint. The
 * source of truth at checkout is always USD.
 *
 * Last updated: 2026-Q2.
 */
const STATIC_FX_RATES: Readonly<Record<string, number>> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  // LATAM
  MXN: 17.5,
  BRL: 5.05,
  ARS: 1050,
  CLP: 920,
  COP: 4100,
  PEN: 3.75,
  UYU: 40,
  // Asia-Pacific
  JPY: 150,
  KRW: 1350,
  SGD: 1.34,
  HKD: 7.8,
  TWD: 32,
  INR: 83,
  IDR: 15800,
  THB: 35,
  VND: 24500,
  PHP: 57,
  MYR: 4.7,
  // EU non-EUR
  CHF: 0.88,
  NOK: 10.6,
  SEK: 10.4,
  DKK: 6.85,
  // Other
  ZAR: 18.5,
  TRY: 32,
  AED: 3.67,
  ILS: 3.7,
  RUB: 92,
  UAH: 40,
  NGN: 1500,
  EGP: 48,
};

/** Currencies that look better with no fractional digits (yen, won, etc.). */
const ZERO_DECIMAL: ReadonlySet<string> = new Set([
  'JPY', 'KRW', 'IDR', 'VND', 'CLP', 'COP', 'HUF', 'PYG', 'UGX', 'XOF',
]);

export interface CurrencyHint {
  /** ISO 4217 code (e.g., "EUR", "BRL"). */
  code: string;
  /** USD amount × static factor, formatted via Intl.NumberFormat. */
  display: string;
}

/**
 * Resolve the currency to show for a given (locale, optional country).
 * Country wins when present (geo header) — gives a Frankfurt user EUR
 * even if their browser is set to en-US.
 */
export function resolveDisplayCurrency(
  locale: Locale,
  countryCode?: string | null,
): string {
  if (countryCode) {
    const fromCountry = COUNTRY_CURRENCY.get(countryCode.toUpperCase());
    if (fromCountry) return fromCountry;
  }
  return LOCALE_DEFAULT_CURRENCY[locale] ?? 'USD';
}

/**
 * Format a USD amount into the local currency hint. Returns null when
 * the resolved currency is USD (no hint needed) or when the rate is
 * unknown.
 *
 *   formatLocalHint(19, 'fr', 'FR') → { code: 'EUR', display: '€17.48' }
 *   formatLocalHint(19, 'en', 'US') → null (USD, no hint)
 */
export function formatLocalHint(
  usdAmount: number,
  locale: Locale,
  countryCode?: string | null,
): CurrencyHint | null {
  const code = resolveDisplayCurrency(locale, countryCode);
  if (code === 'USD') return null;
  const rate = STATIC_FX_RATES[code];
  if (rate === undefined) return null;
  const local = usdAmount * rate;
  const fractionDigits = ZERO_DECIMAL.has(code) ? 0 : 2;
  const display = new Intl.NumberFormat(localeForCurrency(locale, code), {
    style: 'currency',
    currency: code,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(local);
  return { code, display };
}

/**
 * Format a USD amount in USD, locale-aware (en uses $19, fr uses 19 $US,
 * es uses 19 US$). Used by the canonical price tag — always the source
 * of truth.
 */
export function formatUsd(
  usdAmount: number,
  locale: Locale,
): string {
  return new Intl.NumberFormat(localeForCurrency(locale, 'USD'), {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: usdAmount < 1 ? 4 : 2,
  }).format(usdAmount);
}

/** Pick the Intl locale tag that produces the most natural-looking
 *  currency formatting. For EUR in a French context we want `fr-FR`;
 *  for BRL we want `pt-BR`; etc. Falls back to the route locale. */
function localeForCurrency(routeLocale: Locale, currency: string): string {
  if (currency === 'EUR' && routeLocale === 'fr') return 'fr-FR';
  if (currency === 'EUR' && routeLocale === 'es') return 'es-ES';
  if (currency === 'EUR') return 'de-DE';
  if (currency === 'BRL') return 'pt-BR';
  if (currency === 'MXN') return 'es-MX';
  if (currency === 'ARS') return 'es-AR';
  if (currency === 'CLP') return 'es-CL';
  if (currency === 'COP') return 'es-CO';
  if (currency === 'GBP') return 'en-GB';
  if (currency === 'JPY') return 'ja-JP';
  if (currency === 'KRW') return 'ko-KR';
  return routeLocale === 'es' ? 'es-MX' : routeLocale === 'fr' ? 'fr-FR' : 'en-US';
}
