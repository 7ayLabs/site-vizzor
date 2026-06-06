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
