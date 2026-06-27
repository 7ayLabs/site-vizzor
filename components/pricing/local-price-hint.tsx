/**
 * LocalPriceHint — cosmetic local-currency sub-line under a USD price.
 *
 * Pure server component. Reads the geo header (`x-vercel-ip-country` /
 * `cf-ipcountry`) and the request locale, runs `formatLocalHint`, and
 * renders "~€17.48" if a non-USD currency resolves; otherwise nothing.
 *
 * Strict UX rules:
 *   - The canonical price ("$19", "$99/yr") stays the source of truth
 *     for what the user is being charged. This hint is purely a
 *     purchasing-power cue.
 *   - When the geo header is missing (dev, edge runtime without geo,
 *     allowlisted IP) the hint silently no-ops.
 *   - The hint is prefixed with "~" so it reads as "approximately",
 *     matching the static-table caveat in lib/currency.ts.
 *
 * Why server, not client: we don't want to flash a USD value then swap
 * to local — that's a layout shift + an "ad" feeling. Computing on the
 * server means the local hint paints with the rest of the price tile.
 */

import { headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { formatLocalHint } from '@/lib/currency';
import { readEdgeCountry } from '@/i18n/detect';
import type { Locale } from '@/i18n/routing';

interface LocalPriceHintProps {
  /** USD amount, e.g. 19 for "$19". Use 0 for free tiers (renders nothing). */
  amountUsd: number;
  /** Optional className for spacing/typography overrides. */
  className?: string;
}

export async function LocalPriceHint({
  amountUsd,
  className,
}: LocalPriceHintProps): Promise<React.ReactElement | null> {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;
  const hdrs = await headers();
  const country = readEdgeCountry(hdrs);
  const locale = (await getLocale()) as Locale;
  const hint = formatLocalHint(amountUsd, locale, country);
  if (!hint) return null;
  return (
    <p
      className={
        className ??
        'mono tabular text-[11.5px] text-[var(--fg-3)] mt-0.5'
      }
      aria-label={`Approximately ${hint.display} in your local currency; charged in USD-equivalent crypto`}
    >
      <span aria-hidden>~</span>
      {hint.display}
    </p>
  );
}
