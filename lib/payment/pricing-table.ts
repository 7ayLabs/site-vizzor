/**
 * Single source of truth for tier-cadence pricing in cents AND for
 * the Solana flat-discount math.
 *
 * v0.2.0 ships Solana-native-only with a single 10% flat discount on
 * every paid SOL transaction. The engine has the same table (and can
 * hot-tune via SQLite overlay per the operator spec). The site copy
 * here is the *display* number we use to render the order summary
 * and to pre-validate the amount before the upstream call.
 *
 * Lifetime is Elite-only by product decision.
 */

import type {
  PaymentCadence,
  PaymentChain,
  PaymentTier,
  PaymentToken,
} from './session';

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
 * Flat Solana-native discount (in basis points). 10% off every paid
 * SOL transaction, independent of tier × cadence.
 */
const SOLANA_DISCOUNT_BPS = 1000;

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

/**
 * Discount basis points for a (tier, cadence, chain, token) combo.
 * Returns SOLANA_DISCOUNT_BPS (1000 = 10%) for solana:native, 0 otherwise.
 *
 * The signature keeps tier+cadence for future per-tier promotions
 * even though the current implementation ignores them.
 */
export function discountBps(
  _tier: PaymentTier,
  _cadence: PaymentCadence,
  chain: PaymentChain,
  token: PaymentToken,
): number {
  if (chain === 'solana' && token === 'native') return SOLANA_DISCOUNT_BPS;
  return 0;
}

/** Discounted price in cents for a (tier, cadence, chain, token) combo. */
export function effectivePriceCents(
  tier: PaymentTier,
  cadence: PaymentCadence,
  chain: PaymentChain,
  token: PaymentToken,
): number | null {
  const base = priceCents(tier, cadence);
  if (base === null) return null;
  const bps = discountBps(tier, cadence, chain, token);
  return Math.round(base * (10000 - bps)) / 10000;
}

export function effectivePriceUsd(
  tier: PaymentTier,
  cadence: PaymentCadence,
  chain: PaymentChain,
  token: PaymentToken,
): string | null {
  const c = effectivePriceCents(tier, cadence, chain, token);
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
