/**
 * Stubs for POST /api/grants/[code]/redeem.
 *
 * Covers the five failure shapes from RFC §5 plus the success shape
 * and the idempotency rule. C5 (payment-qa) wires up Vitest and
 * promotes these stubs to real tests; until then they remain `todo`.
 */

import { describe, it } from 'vitest';

describe('POST /api/grants/[code]/redeem (stubs - wired up by C5 payment-qa)', () => {
  describe('auth', () => {
    it.todo('returns 401 unauthorized when x-vizzor-bot-token is missing');
    it.todo('returns 401 unauthorized when x-vizzor-bot-token is wrong');
    it.todo('accepts VIZZOR_BOT_SHARED_SECRET_NEXT during rotation');
    it.todo('returns 401 in production when VIZZOR_BOT_SHARED_SECRET is unset');
  });

  describe('code shape', () => {
    it.todo('returns 400 invalid_code when code does not match the g_xxxxxxxxxxxxxxxx regex');
    it.todo('returns 400 invalid_code when the grant row does not exist');
  });

  describe('body validation', () => {
    it.todo('returns 400 invalid_input when telegram_user_id is missing');
    it.todo('returns 400 invalid_input when telegram_user_id is not a positive integer');
    it.todo('accepts and discards telegram_username (not persisted)');
  });

  describe('grant lifecycle', () => {
    it.todo('returns 410 expired when now > grants.expires_at');
    it.todo('returns 412 session_not_confirmed when the underlying session is pending');
    it.todo('returns 409 already_redeemed when redeemed_by != requesting tg id');
  });

  describe('atomic transaction', () => {
    it.todo('marks grant redeemed, sets subscriptions.telegram_user_id, and inserts wallet_links in one tx');
    it.todo('rolls back all three writes when any step fails');
    it.todo('insert wallet_links is INSERT OR IGNORE — idempotent retry does not duplicate');
  });

  describe('idempotency', () => {
    it.todo('a second call with the same (code, telegram_user_id) returns 200 with the existing subscription');
    it.todo('a second call with a different telegram_user_id returns 409 already_redeemed');
  });

  describe('wallet-link conflict', () => {
    it.todo('returns 409 already_redeemed when subscription.wallet is linked to a different tg id');
    it.todo('returns 409 already_redeemed when the requesting tg id is already linked to a different wallet');
  });

  describe('success response shape', () => {
    it.todo('200 body is { ok: true, subscription: { tier, cadence, expires_at, wallet_address } }');
    it.todo('sets Cache-Control: no-store');
  });
});
