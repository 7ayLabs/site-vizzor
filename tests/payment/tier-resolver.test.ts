/**
 * Tier resolver tests — cover the four discriminated states + the
 * idempotent trial-start helper. Uses the global per-pid SQLite DB
 * the setup file installs; each test inserts its own wallet so they
 * don't share state.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { startTrialIfNew, getDb } from '@/lib/payment/db';
import {
  resolveTier,
  resolveTierWithTrialStart,
} from '@/lib/payment/tier-resolver';

/**
 * Seed a paid subscription row without going through the
 * `insertSubscription` helper — that helper enforces a FK to
 * `payment_sessions` which we don't need to populate for the
 * resolver's purposes. Toggling foreign_keys OFF for the single
 * INSERT keeps the rest of the test suite's referential integrity
 * intact.
 */
function seedSubscription(
  wallet: string,
  tier: 'pro' | 'elite' | 'lifetime',
  expiresAt: number,
): void {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  try {
    db.prepare(
      `INSERT INTO subscriptions (wallet_address, tier, cadence, expires_at, session_id)
       VALUES (?, ?, 'monthly', ?, ?)`,
    ).run(wallet, tier, expiresAt, `sess-${Math.random().toString(36).slice(2)}`);
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function uniqueWallet(prefix: string): string {
  // Test wallets don't need to be valid base58 — the resolver doesn't
  // decode them. Suffix with a random int to keep tests isolated.
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function clearWallet(wallet: string): void {
  getDb()
    .prepare(`DELETE FROM wallet_free_usage WHERE wallet_address = ?`)
    .run(wallet);
  getDb()
    .prepare(`DELETE FROM subscriptions WHERE wallet_address = ?`)
    .run(wallet);
}

const DAY = 86_400_000;

describe('resolveTier', () => {
  let wallet: string;
  beforeEach(() => {
    wallet = uniqueWallet('test-wallet');
    clearWallet(wallet);
  });

  it('returns free:never_started for a brand-new wallet', () => {
    const effective = resolveTier(wallet);
    expect(effective.kind).toBe('free');
    if (effective.kind === 'free') {
      expect(effective.reason).toBe('never_started');
    }
  });

  it('returns trial with full window after startTrialIfNew', () => {
    startTrialIfNew(wallet);
    const effective = resolveTier(wallet);
    expect(effective.kind).toBe('trial');
    if (effective.kind === 'trial') {
      expect(effective.daysRemaining).toBe(7);
      expect(effective.dailyUsed).toBe(0);
      expect(effective.dailyCap).toBe(10);
    }
  });

  it('returns free:trial_expired 8 days after the anchor', () => {
    startTrialIfNew(wallet);
    // Backdate trial_started_at to 8 days ago.
    const eightDaysAgo = Date.now() - 8 * DAY;
    getDb()
      .prepare(
        `UPDATE wallet_free_usage SET trial_started_at = ? WHERE wallet_address = ?`,
      )
      .run(eightDaysAgo, wallet);
    const effective = resolveTier(wallet);
    expect(effective.kind).toBe('free');
    if (effective.kind === 'free') {
      expect(effective.reason).toBe('trial_expired');
    }
  });

  it('returns pro when a Pro subscription is active', () => {
    seedSubscription(wallet, 'pro', Date.now() + 30 * DAY);
    const effective = resolveTier(wallet);
    expect(effective.kind).toBe('pro');
    if (effective.kind === 'pro') {
      expect(effective.dailyCap).toBe(1000);
    }
  });

  it('returns elite when an Elite subscription is active', () => {
    seedSubscription(wallet, 'elite', Date.now() + 30 * DAY);
    const effective = resolveTier(wallet);
    expect(effective.kind).toBe('elite');
  });

  it('startTrialIfNew is idempotent — the anchor never moves on a repeat call', () => {
    const firstNow = Date.now() - 3 * DAY;
    // Seed via direct UPSERT so we control the trial_started_at value.
    getDb()
      .prepare(
        `INSERT INTO wallet_free_usage
           (wallet_address, used, first_used_at, last_used_at, trial_started_at)
         VALUES (?, 0, ?, ?, ?)`,
      )
      .run(wallet, firstNow, firstNow, firstNow);
    // Second call should not overwrite — anchor stays at firstNow.
    const returnedAnchor = startTrialIfNew(wallet);
    expect(returnedAnchor).toBe(firstNow);
    const effective = resolveTier(wallet);
    if (effective.kind === 'trial') {
      expect(effective.daysRemaining).toBeLessThanOrEqual(5); // ~4 days remain
    } else {
      throw new Error(`expected trial, got ${effective.kind}`);
    }
  });

  it('resolveTierWithTrialStart transitions never_started → trial atomically', () => {
    const before = resolveTier(wallet);
    expect(before.kind).toBe('free');
    const after = resolveTierWithTrialStart(wallet);
    expect(after.kind).toBe('trial');
  });
});
