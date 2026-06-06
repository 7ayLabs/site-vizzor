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

describe('discountBps — per-chain matrix', () => {
  it('applies 15% on solana:native (primary rail)', () => {
    expect(discountBps('pro', 'monthly', 'solana', 'native')).toBe(1500);
    expect(discountBps('elite', 'lifetime', 'solana', 'native')).toBe(1500);
  });

  it('applies 10% on ton:native', () => {
    expect(discountBps('pro', 'monthly', 'ton', 'native')).toBe(1000);
    expect(discountBps('elite', 'lifetime', 'ton', 'native')).toBe(1000);
  });

  it('applies 5% on USDC L2 rails', () => {
    expect(discountBps('pro', 'monthly', 'base', 'usdc')).toBe(500);
    expect(discountBps('elite', 'lifetime', 'arbitrum', 'usdc')).toBe(500);
  });

  it('returns 0 for unsupported chain × token pairs', () => {
    expect(discountBps('pro', 'monthly', 'solana', 'usdc')).toBe(0);
    expect(discountBps('pro', 'monthly', 'ton', 'usdc')).toBe(0);
  });
});

describe('effectivePriceCents', () => {
  it('applies the SOL discount and rounds to integer cents', () => {
    // Pro monthly $9.99 × 85% = $8.4915 → 849.15 cents.
    const cents = effectivePriceCents('pro', 'monthly', 'solana', 'native');
    expect(cents).toBeCloseTo(849.15, 1);
  });

  it('applies the 15% SOL lifetime discount to $1,249', () => {
    const cents = effectivePriceCents(
      'elite',
      'lifetime',
      'solana',
      'native',
    );
    // 124900 * 0.85 = 106165 cents = $1,061.65
    expect(cents).toBe(106165);
  });

  it('returns null for invalid tier-cadence combos', () => {
    expect(
      effectivePriceCents('pro', 'lifetime', 'solana', 'native'),
    ).toBeNull();
  });
});

describe('effectivePriceUsd — display formatting', () => {
  it('formats with two-decimal precision per rail', () => {
    expect(effectivePriceUsd('pro', 'monthly', 'solana', 'native')).toBe(
      '$8.49',
    );
    expect(effectivePriceUsd('pro', 'monthly', 'ton', 'native')).toBe(
      '$8.99',
    );
    expect(effectivePriceUsd('pro', 'monthly', 'base', 'usdc')).toBe(
      '$9.49',
    );
  });
});
