/**
 * Stubs for POST /api/wallet-links (bot-initiated SIWS pre-link).
 *
 * The route requires BOTH the shared-secret header AND a valid SIWS
 * signature scoped to the link-wallet purpose. C5 (payment-qa)
 * promotes these stubs to real tests.
 */

import { describe, it } from 'vitest';

describe('POST /api/wallet-links (stubs - wired up by C5 payment-qa)', () => {
  describe('auth (shared secret)', () => {
    it.todo('returns 401 unauthorized when x-vizzor-bot-token is missing');
    it.todo('returns 401 unauthorized when x-vizzor-bot-token is wrong');
  });

  describe('body validation', () => {
    it.todo('returns 400 invalid_input when telegram_user_id is missing or non-positive');
    it.todo('returns 400 invalid_input when wallet is not a valid base58 Solana address');
    it.todo('returns 400 invalid_input when nonce is missing or not lowercase hex');
    it.todo('returns 400 invalid_input when issued_at is not a parseable ISO string');
    it.todo('returns 400 invalid_input when expires_at is not a parseable ISO string');
    it.todo('returns 400 invalid_input when issued_at >= expires_at');
    it.todo('returns 400 invalid_input when issued_at is more than 5 minutes in the future');
  });

  describe('expiry', () => {
    it.todo('returns 410 expired when expires_at is in the past');
  });

  describe('signature verification', () => {
    it.todo('returns 401 invalid_signature when signature does not verify against reconstructed canonical message');
    it.todo('rebuilds the canonical message server-side (does not trust client-supplied message)');
    it.todo('rejects a signature over a buildSiwsMessage (login) variant — scope tightening');
    it.todo('accepts a signature over a buildLinkWalletMessage that binds the same telegram_user_id');
    it.todo('rejects a signature over a buildLinkWalletMessage with a different telegram_user_id');
  });

  describe('persistence and conflict', () => {
    it.todo('inserts a fresh wallet_links row with siws_token populated by the signature');
    it.todo('returns 200 { already_linked: true } when the exact (tg, wallet) pair already exists');
    it.todo('returns 409 already_linked_elsewhere when wallet is bound to a different tg');
    it.todo('returns 409 already_linked_elsewhere when tg id is bound to a different wallet');
    it.todo('does not silently re-attribute (no UPDATE on conflict)');
  });

  describe('response shape', () => {
    it.todo('200 body is { ok: true, already_linked: boolean }');
    it.todo('sets Cache-Control: no-store on every response');
  });
});
