/**
 * Single source of truth for tier-cadence pricing in cents.
 *
 * The engine has the same table (and can hot-tune via SQLite overlay per
 * the operator spec). The site copy here is the *display* number we use
 * to render the order summary and to pre-validate the amount before the
 * upstream call. The engine is the canonical authority — if the site
 * and engine disagree, the engine wins (validates input on createSession).
 *
 * Lifetime is Elite-only by product decision.
 */

import type { PaymentCadence, PaymentTier } from './session';

export const TIER_PRICES_USD_CENTS: Readonly<
  Record<PaymentTier, Partial<Record<PaymentCadence, number>>>
> = {
  pro: {
    monthly: 999, // $9.99
    annual: 9900, // $99.00
  },
  elite: {
    monthly: 9900, // $99.00
    annual: 99900, // $999.00
    lifetime: 249900, // $2,499.00
  },
};

export function priceCents(
  tier: PaymentTier,
  cadence: PaymentCadence,
): number | null {
  return TIER_PRICES_USD_CENTS[tier]?.[cadence] ?? null;
}

export function priceUsd(
  tier: PaymentTier,
  cadence: PaymentCadence,
): string | null {
  const c = priceCents(tier, cadence);
  if (c === null) return null;
  return `$${(c / 100).toFixed(2)}`;
}

/** True if (tier, cadence) is a valid combo (e.g. Pro doesn't sell lifetime). */
export function isValidCombo(
  tier: string,
  cadence: string,
): tier is PaymentTier {
  return (
    (tier === 'pro' || tier === 'elite') &&
    (cadence === 'monthly' || cadence === 'annual' || cadence === 'lifetime') &&
    priceCents(tier as PaymentTier, cadence as PaymentCadence) !== null
  );
}
