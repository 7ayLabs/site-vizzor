/**
 * pricing-table.ts — Solana-only discount math.
 *
 * Pure logic; no DB, no network. v0.2.0 ships a single flat 10%
 * discount on every Solana-native paid transaction.
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

describe('discountBps — Solana native flat 10%', () => {
  it('applies 10% for every (tier, cadence) on solana:native', () => {
    expect(discountBps('pro', 'monthly', 'solana', 'native')).toBe(1000);
    expect(discountBps('pro', 'annual', 'solana', 'native')).toBe(1000);
    expect(discountBps('elite', 'monthly', 'solana', 'native')).toBe(1000);
    expect(discountBps('elite', 'annual', 'solana', 'native')).toBe(1000);
    expect(discountBps('elite', 'lifetime', 'solana', 'native')).toBe(1000);
  });
});

describe('effectivePriceCents', () => {
  it('applies the discount and rounds to integer cents', () => {
    // Pro monthly $9.99 × 90% = $8.991 → 899.1 cents.
    const cents = effectivePriceCents('pro', 'monthly', 'solana', 'native');
    expect(cents).toBeCloseTo(899.1, 1);
  });

  it('applies the 10% Solana lifetime discount to $1,249', () => {
    const cents = effectivePriceCents(
      'elite',
      'lifetime',
      'solana',
      'native',
    );
    // 124900 * 0.90 = 112410 cents = $1,124.10
    expect(cents).toBe(112410);
  });

  it('returns null for invalid tier-cadence combos', () => {
    expect(
      effectivePriceCents('pro', 'lifetime', 'solana', 'native'),
    ).toBeNull();
  });
});

describe('effectivePriceUsd — display formatting', () => {
  it('formats with two-decimal precision', () => {
    expect(effectivePriceUsd('pro', 'monthly', 'solana', 'native')).toBe(
      '$8.99',
    );
    expect(effectivePriceUsd('elite', 'lifetime', 'solana', 'native')).toBe(
      '$1124.10',
    );
  });
});
