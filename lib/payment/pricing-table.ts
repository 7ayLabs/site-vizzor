/**
 * Single source of truth for tier-cadence pricing in cents AND for
 * the per-chain discount math.
 *
 * Discount matrix (per PRICING_MODEL.md strategy doc):
 *   - SOL on Solana:        15% off  (primary rail, sub-second finality)
 *   - TON native on TON:    10% off  (in-Telegram wallet UX, instant confirm)
 *   - USDC on Base:          5% off  (Circle USDC, USD-stable, L2 gas)
 *   - USDC on Arbitrum:      5% off  (Circle USDC, USD-stable, L2 gas)
 *
 * Lifetime is Elite-only by product decision.
 */

import type {
  PaymentCadence,
  PaymentChain,
  PaymentTier,
  PaymentToken,
} from './session';

/**
 * Tier × cadence price ladder, in USD cents.
 *
 * Repriced from the original Vega ladder ($9.99 / $49 / $1,249) to
 * match the "category-defining crypto intelligence AI" positioning.
 * Pricing signals quality — sub-$10/mo screams "Telegram scam bot,"
 * while $19 / $99 puts Vizzor in the "real product" range that
 * serious traders trust. The new lifetime anchor at $1,499 makes
 * Pro Annual feel cheaper and rewards the highest-trust buyer
 * segment without trapping the engine value at "side-project bet."
 *
 * Institutional ($999-$2,999/mo) is handled outside this table — the
 * /pay route validates monthly/annual/lifetime only, and the
 * institutional card on /pricing routes to a sales contact, not the
 * on-site checkout.
 */
export const TIER_PRICES_USD_CENTS: Readonly<
  Record<PaymentTier, Partial<Record<PaymentCadence, number>>>
> = {
  pro: {
    monthly: 1900, // $19
    annual: 19000, // $190
  },
  elite: {
    monthly: 9900, // $99
    annual: 99000, // $990
    lifetime: 149900, // $1,499
  },
};

/**
 * Per-chain flat discount basis points (independent of tier × cadence).
 * The key is a `${chain}:${token}` join so a new chain doesn't risk
 * accidentally inheriting another chain's discount.
 */
const CHAIN_DISCOUNT_BPS: Readonly<Record<string, number>> = {
  'solana:native': 1500,
  'ton:native': 1000,
  'base:usdc': 500,
  'arbitrum:usdc': 500,
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

/**
 * Discount basis points for a (tier, cadence, chain, token) combo.
 * Returns 0 for unsupported pairs.
 */
export function discountBps(
  _tier: PaymentTier,
  _cadence: PaymentCadence,
  chain: PaymentChain,
  token: PaymentToken,
): number {
  return CHAIN_DISCOUNT_BPS[`${chain}:${token}`] ?? 0;
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
