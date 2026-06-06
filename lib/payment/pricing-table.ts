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
 * $VIZZOR-pay discount basis points (10000 = 100%, 2500 = 25% off).
 * Per PRICING_MODEL.md:
 *   - Pro:           25% off (any cadence)
 *   - Elite m/y:     30% off
 *   - Elite lifetime: 35% off
 *
 * Gated by `isVzrLive()` at the route layer; surfaced here only when
 * the caller passes token='vizzor'.
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

/**
 * Per-chain flat discount basis points (independent of tier × cadence).
 * Strategy doc: each chain gets a marketing-aligned discount.
 *   - TON native:        15% off (TON ecosystem alignment, in-bot UX)
 *   - Solana native SOL: 10% off (fastest finality, lowest fees)
 *   - Base / Arbitrum USDC: 5% off (EVM credibility, USD-stable)
 *
 * Stacks with the VIZZOR tier-cadence table when the user pays in
 * $VIZZOR on Solana — but we only apply ONE discount at a time, and
 * $VIZZOR beats the flat SOL discount because the tier-cadence math
 * is always >= 10%.
 */
const CHAIN_DISCOUNT_BPS: Readonly<
  Record<PaymentChain, Partial<Record<PaymentToken, number>>>
> = {
  ton: { native: 1500 },
  solana: { native: 1000 },
  base: { usdc: 500 },
  arbitrum: { usdc: 500 },
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
 * Returns 0 if no discount applies.
 *
 * Resolution order:
 *   1. $VIZZOR on Solana — tier-cadence table (25/30/35%). Highest.
 *   2. Per-chain flat — 15% TON / 10% SOL / 5% USDC.
 *   3. Otherwise — 0.
 *
 * Only one discount applies; we don't stack chain + token. The
 * highest-eligible discount wins.
 */
export function discountBps(
  tier: PaymentTier,
  cadence: PaymentCadence,
  chain: PaymentChain,
  token: PaymentToken,
): number {
  if (chain === 'solana' && token === 'vizzor') {
    return VIZZOR_DISCOUNT_BPS[tier]?.[cadence] ?? 0;
  }
  return CHAIN_DISCOUNT_BPS[chain]?.[token] ?? 0;
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
