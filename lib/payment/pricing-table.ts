/**
 * Single source of truth for tier-cadence pricing in cents AND for
 * the $VIZZOR discount math (per the PRICING_MODEL.md strategy doc).
 *
 * The engine has the same table (and can hot-tune via SQLite overlay per
 * the operator spec). The site copy here is the *display* number we use
 * to render the order summary and to pre-validate the amount before the
 * upstream call. The engine is the canonical authority — if the site
 * and engine disagree, the engine wins (validates input on createSession).
 *
 * Lifetime is Elite-only by product decision.
 */

import type { PaymentCadence, PaymentTier, PaymentToken } from './session';

export const TIER_PRICES_USD_CENTS: Readonly<
  Record<PaymentTier, Partial<Record<PaymentCadence, number>>>
> = {
  pro: {
    monthly: 999, // $9.99
    annual: 9900, // $99.00
  },
  elite: {
    monthly: 4900, // $49.00
    annual: 49900, // $499.00
    lifetime: 124900, // $1,249.00
  },
};

/**
 * $VIZZOR-pay discount basis points (10000 = 100%, 2500 = 25% off).
 * Per PRICING_MODEL.md:
 *   - Pro:           25% off (any cadence)
 *   - Elite m/y:     30% off
 *   - Elite lifetime: 35% off
 */
const VIZZOR_DISCOUNT_BPS: Readonly<
  Record<PaymentTier, Partial<Record<PaymentCadence, number>>>
> = {
  pro: {
    monthly: 2500,
    annual: 2500,
  },
  elite: {
    monthly: 3000,
    annual: 3000,
    lifetime: 3500,
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

/** Discount basis points for a (tier, cadence, token) combo. 0 if not eligible. */
export function discountBps(
  tier: PaymentTier,
  cadence: PaymentCadence,
  token: PaymentToken,
): number {
  if (token !== 'vizzor') return 0;
  return VIZZOR_DISCOUNT_BPS[tier]?.[cadence] ?? 0;
}

/** Discounted price in cents for a (tier, cadence, token) combo. */
export function effectivePriceCents(
  tier: PaymentTier,
  cadence: PaymentCadence,
  token: PaymentToken,
): number | null {
  const base = priceCents(tier, cadence);
  if (base === null) return null;
  const bps = discountBps(tier, cadence, token);
  return Math.round(base * (10000 - bps)) / 10000;
}

export function effectivePriceUsd(
  tier: PaymentTier,
  cadence: PaymentCadence,
  token: PaymentToken,
): string | null {
  const c = effectivePriceCents(tier, cadence, token);
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
