/**
 * Stubs for GET /api/subscriptions/lookup.
 *
 * Covers the architect's locked no-cache decision, the env-driven
 * escape hatch, the null-subscription-as-success contract, and the
 * auth surface. C5 (payment-qa) promotes these stubs.
 */

import { describe, it } from 'vitest';

describe('GET /api/subscriptions/lookup (stubs - wired up by C5 payment-qa)', () => {
  describe('auth', () => {
    it.todo('returns 401 unauthorized when x-vizzor-bot-token is missing');
    it.todo('returns 401 unauthorized when x-vizzor-bot-token is wrong');
    it.todo('accepts VIZZOR_BOT_SHARED_SECRET_NEXT during rotation');
  });

  describe('query validation', () => {
    it.todo('returns 400 invalid_input when telegram_user_id query is absent');
    it.todo('returns 400 invalid_input when telegram_user_id is not a positive integer');
    it.todo('returns 400 invalid_input when telegram_user_id is negative or zero');
  });

  describe('happy path', () => {
    it.todo('returns 200 { ok: true, subscription: {...} } when an active sub exists');
    it.todo('returns 200 { ok: true, subscription: null } when no sub exists (null is success, not error)');
    it.todo('filters out subscriptions whose expires_at is in the past');
    it.todo('returns the lifetime sub when expires_at is NULL');
    it.todo('sets Cache-Control: no-store on every response');
  });

  describe('cache policy (default off)', () => {
    it.todo('does not cache when VIZZOR_BIND_LOOKUP_CACHE_TTL_MS is unset');
    it.todo('does not cache when VIZZOR_BIND_LOOKUP_CACHE_TTL_MS is "0"');
    it.todo('does not cache when VIZZOR_BIND_LOOKUP_CACHE_TTL_MS is a non-numeric string');
  });

  describe('cache policy (escape hatch on)', () => {
    it.todo('serves a cached null for the configured TTL when VIZZOR_BIND_LOOKUP_CACHE_TTL_MS > 0');
    it.todo('serves a cached subscription row for the configured TTL');
    it.todo('cache expires after TTL elapses and a fresh DB read happens');
    it.todo('cache is keyed by telegram_user_id (no cross-user leakage)');
    it.todo('cache eviction kicks in at CACHE_MAX_ENTRIES (1024) entries');
  });
});
