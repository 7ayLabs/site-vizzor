/**
 * Stubs for the wallet-telegram binding library surface.
 *
 * These tests intentionally do not run yet. C5 (payment-qa) wires up
 * Vitest, the test database fixture (`tests/setup.ts`), and the
 * `pnpm test` script. Until that lands, this file exists so the
 * contract surface is visible in the diff and so C5 picks up the
 * stubs as the starting point for the real coverage pass.
 *
 * Surface under test (v0.2.0):
 *   - `insertWalletLink` (strict and non-strict modes)
 *   - `findWalletLinkByTelegramId`
 *   - `findWalletLinkByWallet`
 *   - `attachTelegramIdToSubscription`
 *   - `findSubscriptionByTelegramId`
 *   - `findSubscriptionBySessionId`
 *   - `addColumnIfMissing` idempotency on re-run of `init()`
 *   - `buildLinkWalletMessage` canonical bytes and TG-id binding
 */

import { describe, it } from 'vitest';

describe('wallet-telegram binding (stubs - wired up by C5 payment-qa)', () => {
  describe('insertWalletLink', () => {
    it.todo('inserts a fresh (tg, wallet) pair and returns inserted=true');
    it.todo('non-strict mode no-ops on duplicate without throwing');
    it.todo('strict mode throws SQLITE_CONSTRAINT_UNIQUE on duplicate wallet');
    it.todo('strict mode throws SQLITE_CONSTRAINT_UNIQUE on duplicate telegram_user_id');
    it.todo('persists siws_token when provided for forensic audit');
  });

  describe('findWalletLinkByTelegramId / findWalletLinkByWallet', () => {
    it.todo('returns null when no row exists for the queried key');
    it.todo('returns the row when the binding exists');
    it.todo('does not cross-leak: a tg id matches only its own wallet');
  });

  describe('attachTelegramIdToSubscription', () => {
    it.todo('sets telegram_user_id when subscription column is NULL');
    it.todo('is a no-op when the column already matches the same id');
    it.todo('does not overwrite a different existing id (returns changed=false)');
  });

  describe('findSubscriptionByTelegramId', () => {
    it.todo('returns the most recent active subscription for the tg id');
    it.todo('filters out subscriptions whose expires_at is in the past');
    it.todo('returns the lifetime subscription when expires_at is NULL');
  });

  describe('findSubscriptionBySessionId', () => {
    it.todo('returns the subscription row attached to a confirmed session');
    it.todo('returns null when the session has no subscription');
  });

  describe('addColumnIfMissing migration helper', () => {
    it.todo('is a no-op on a database that already has the column');
    it.todo('adds the column on a pre-v0.2.0 database fixture');
    it.todo('runV020Migrations is idempotent across two init() calls');
  });

  describe('buildLinkWalletMessage canonical bytes', () => {
    it.todo('contains the Purpose: Link Telegram Account <id> line');
    it.todo('refuses non-positive integer telegram user ids');
    it.todo('produces a different message than buildSiwsMessage for the same nonce');
    it.todo('changing the tg id changes the message bytes (scope binding)');
  });
});
