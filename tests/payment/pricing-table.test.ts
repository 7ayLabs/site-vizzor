/**
 * pricing-table.ts — chain-aware discount math.
 *
 * Pure logic; no DB, no network. Covers every published rail in the
 * v0.2.0 PRICING_MODEL.md matrix and asserts the per-chain discount
 * basis points + effective price.
 */

import { describe, it, expect } from 'vitest';
import {
  discountBps,
  effectivePriceCents,
  effectivePriceUsd,
  isValidCombo,
  priceCents,
  priceUsd,
} from '@/lib/payment/pricing-table';

describe('priceCents / priceUsd', () => {
  it('returns the canonical PRICING_MODEL.md values', () => {
    expect(priceCents('pro', 'monthly')).toBe(999);
    expect(priceCents('pro', 'annual')).toBe(9900);
    expect(priceCents('elite', 'monthly')).toBe(4900);
    expect(priceCents('elite', 'annual')).toBe(49900);
    expect(priceCents('elite', 'lifetime')).toBe(124900);
    expect(priceUsd('elite', 'lifetime')).toBe('$1249.00');
  });

  it('returns null for invalid tier-cadence combos', () => {
    expect(priceCents('pro', 'lifetime')).toBeNull();
    expect(priceUsd('pro', 'lifetime')).toBeNull();
  });
});

describe('isValidCombo', () => {
  it('accepts every PRICING_MODEL.md combo', () => {
    expect(isValidCombo('pro', 'monthly')).toBe(true);
    expect(isValidCombo('pro', 'annual')).toBe(true);
    expect(isValidCombo('elite', 'monthly')).toBe(true);
    expect(isValidCombo('elite', 'annual')).toBe(true);
    expect(isValidCombo('elite', 'lifetime')).toBe(true);
  });

  it('rejects pro lifetime (elite-only)', () => {
    expect(isValidCombo('pro', 'lifetime')).toBe(false);
  });

  it('rejects unknown tier or cadence', () => {
    expect(isValidCombo('whale', 'monthly')).toBe(false);
    expect(isValidCombo('pro', 'weekly')).toBe(false);
  });
});

describe('discountBps — VIZZOR tier-cadence table', () => {
  it('applies 25% for pro × VIZZOR regardless of cadence', () => {
    expect(discountBps('pro', 'monthly', 'solana', 'vizzor')).toBe(2500);
    expect(discountBps('pro', 'annual', 'solana', 'vizzor')).toBe(2500);
  });

  it('applies 30% for elite monthly/annual × VIZZOR', () => {
    expect(discountBps('elite', 'monthly', 'solana', 'vizzor')).toBe(3000);
    expect(discountBps('elite', 'annual', 'solana', 'vizzor')).toBe(3000);
  });

  it('applies 35% for elite lifetime × VIZZOR (the highest tier)', () => {
    expect(discountBps('elite', 'lifetime', 'solana', 'vizzor')).toBe(3500);
  });
});

describe('discountBps — per-chain flat matrix', () => {
  it('TON native is 15%', () => {
    expect(discountBps('pro', 'monthly', 'ton', 'native')).toBe(1500);
    expect(discountBps('elite', 'lifetime', 'ton', 'native')).toBe(1500);
  });

  it('Solana native (non-VIZZOR) is 10%', () => {
    expect(discountBps('pro', 'monthly', 'solana', 'native')).toBe(1000);
    expect(discountBps('elite', 'annual', 'solana', 'native')).toBe(1000);
  });

  it('Base USDC is 5%', () => {
    expect(discountBps('pro', 'monthly', 'base', 'usdc')).toBe(500);
    expect(discountBps('elite', 'lifetime', 'base', 'usdc')).toBe(500);
  });

  it('Arbitrum USDC is 5%', () => {
    expect(discountBps('pro', 'annual', 'arbitrum', 'usdc')).toBe(500);
    expect(discountBps('elite', 'monthly', 'arbitrum', 'usdc')).toBe(500);
  });

  it('returns 0 for chain × token pairs not on the matrix', () => {
    // EVM token on Solana, native on Base, etc. — silent reject.
    expect(discountBps('pro', 'monthly', 'solana', 'usdc')).toBe(0);
    expect(discountBps('pro', 'monthly', 'base', 'native')).toBe(0);
    expect(discountBps('pro', 'monthly', 'ton', 'usdc')).toBe(0);
  });
});

describe('discountBps — VIZZOR beats per-chain when both apply', () => {
  it('Solana × VIZZOR uses the tier-cadence table, not the flat 10%', () => {
    // Solana native is 10% (1000 bps), Solana VIZZOR is 25-35% — the
    // higher always wins because we never stack.
    const elite = discountBps('elite', 'lifetime', 'solana', 'vizzor');
    expect(elite).toBe(3500);
    expect(elite).toBeGreaterThan(1000);
  });
});

describe('effectivePriceCents', () => {
  it('applies the discount and rounds to integer cents', () => {
    // Pro monthly $9.99 × 75% (25% off VIZZOR) = $7.4925 → 749.25 cents.
    // Math.round * (10000 - 2500) / 10000 = 749.25 — the formula keeps
    // a single-cent precision before rounding.
    const cents = effectivePriceCents('pro', 'monthly', 'solana', 'vizzor');
    expect(cents).toBeCloseTo(749.25, 2);
  });

  it('applies the 35% VIZZOR lifetime discount to $1,249', () => {
    const cents = effectivePriceCents(
      'elite',
      'lifetime',
      'solana',
      'vizzor',
    );
    // 124900 * 0.65 = 81185 cents = $811.85
    expect(cents).toBeCloseTo(81185, 0);
  });

  it('returns null for invalid tier-cadence combos', () => {
    expect(
      effectivePriceCents('pro', 'lifetime', 'solana', 'vizzor'),
    ).toBeNull();
  });

  it('returns the base price when no discount applies', () => {
    // EVM USDC on Solana doesn't exist in our matrix — 0 bps.
    expect(effectivePriceCents('pro', 'monthly', 'solana', 'usdc')).toBe(999);
  });
});

describe('effectivePriceUsd — display formatting', () => {
  it('formats with two-decimal precision', () => {
    expect(effectivePriceUsd('pro', 'monthly', 'ton', 'native')).toBe('$8.49');
    expect(effectivePriceUsd('elite', 'lifetime', 'solana', 'vizzor')).toBe(
      '$811.85',
    );
  });
});
