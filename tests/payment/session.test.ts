/**
 * session.ts — payment session lifecycle.
 *
 * Focuses on the load-bearing seam from plan §10.3:
 *
 *   1. finalizeSession is atomic — calling twice for the same row
 *      yields one subscription, not two.
 *   2. finalizeSession's wallet-link express lane back-fills
 *      subscriptions.telegram_user_id when the payer wallet is
 *      already in wallet_links.
 *   3. issueGrantForSession is idempotent — the same session
 *      returns the same code.
 *   4. createSession rejects invalid combos before touching state.
 */

import { describe, it, expect } from 'vitest';
import {
  cadenceExpiry,
  createSession,
  finalizeSession,
  issueGrantForSession,
} from '@/lib/payment/session';
import {
  findActiveSubscriptionByWallet,
  findSubscriptionBySessionId,
  getDb,
  getSessionRow,
  insertSession,
  insertWalletLink,
  type SessionRow,
} from '@/lib/payment/db';

const PAYER = 'PayerWalletAddressForTests1111111111111';
const SESSION_ID = 'ses_test_finalize_0001';

function insertPendingSession(overrides: Partial<SessionRow> = {}): SessionRow {
  const memo = overrides.memo === null ? undefined : overrides.memo;
  insertSession({
    session_id: overrides.session_id ?? SESSION_ID,
    tier: overrides.tier ?? 'pro',
    cadence: overrides.cadence ?? 'monthly',
    chain: overrides.chain ?? 'solana',
    token: overrides.token ?? 'vizzor',
    dest_address: overrides.dest_address ?? '11111111111111111111111111111111',
    amount: overrides.amount ?? 100,
    decimals: overrides.decimals ?? 9,
    amount_usd_cents: overrides.amount_usd_cents ?? 999,
    discount_bps: overrides.discount_bps ?? 2500,
    rate_locked: overrides.rate_locked ?? 0.1,
    expires_at: overrides.expires_at ?? Date.now() + 5 * 60 * 1000,
    status: overrides.status ?? 'pending',
    memo: memo ?? SESSION_ID,
  });
  const row = getSessionRow(overrides.session_id ?? SESSION_ID);
  if (!row) throw new Error('test fixture row missing');
  return row;
}

describe('cadenceExpiry', () => {
  it('returns null for lifetime — never expires', () => {
    expect(cadenceExpiry('lifetime')).toBeNull();
  });

  it('returns ~30d in the future for monthly', () => {
    const result = cadenceExpiry('monthly');
    expect(result).not.toBeNull();
    const days = ((result as number) - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  it('returns ~365d in the future for annual', () => {
    const result = cadenceExpiry('annual');
    expect(result).not.toBeNull();
    const days = ((result as number) - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(364);
    expect(days).toBeLessThan(366);
  });

  it('falls back to monthly for unknown cadences', () => {
    const result = cadenceExpiry('weekly');
    expect(result).not.toBeNull();
    const days = ((result as number) - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29);
  });
});

describe('finalizeSession atomicity', () => {
  it('marks the session confirmed and mints exactly one subscription', () => {
    const session = insertPendingSession();
    const result = finalizeSession(session, 'txhashA', PAYER);
    expect(result.confirmed).toBe(true);
    expect(result.subscriptionId).toBeDefined();
    expect(result.grantCode).toBeDefined();

    const refreshed = getSessionRow(SESSION_ID);
    expect(refreshed?.status).toBe('confirmed');
    expect(refreshed?.tx_sig).toBe('txhashA');
    expect(refreshed?.grant_code).toBe(result.grantCode);

    const sub = findSubscriptionBySessionId(SESSION_ID);
    expect(sub).not.toBeNull();
    expect(sub?.wallet_address).toBe(PAYER);
  });

  it('is idempotent — a second call on a confirmed session is a no-op', () => {
    const session = insertPendingSession();
    finalizeSession(session, 'txhashA', PAYER);
    const second = finalizeSession(session, 'txhashB', PAYER);
    expect(second.confirmed).toBe(false);

    // Only one subscription should exist for this session.
    const count = getDb()
      .prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE session_id = ?')
      .get(SESSION_ID) as { n: number };
    expect(count.n).toBe(1);

    // The session row still carries the first tx hash.
    expect(getSessionRow(SESSION_ID)?.tx_sig).toBe('txhashA');
  });

  it('confirms but skips subscription mint when payer is empty', () => {
    const session = insertPendingSession();
    const result = finalizeSession(session, 'txhashA', '');
    expect(result.confirmed).toBe(true);
    expect(result.subscriptionId).toBeUndefined();
    expect(result.grantCode).toBeUndefined();
    expect(findSubscriptionBySessionId(SESSION_ID)).toBeNull();
  });
});

describe('finalizeSession wallet-link express lane (plan §10.3)', () => {
  it('eagerly back-fills telegram_user_id from wallet_links', () => {
    const TG_ID = 12345;
    insertWalletLink({
      telegram_user_id: TG_ID,
      wallet_address: PAYER,
      siws_token: 'unit_test_token',
    });

    const session = insertPendingSession();
    const result = finalizeSession(session, 'txhashE', PAYER);
    expect(result.confirmed).toBe(true);
    expect(result.walletLinkedTo).toBe(TG_ID);

    const sub = findActiveSubscriptionByWallet(PAYER, Date.now());
    expect(sub?.telegram_user_id).toBe(TG_ID);
  });

  it('does not back-fill when the payer wallet is unlinked', () => {
    const session = insertPendingSession();
    const result = finalizeSession(session, 'txhashU', PAYER);
    expect(result.confirmed).toBe(true);
    expect(result.walletLinkedTo).toBeUndefined();

    const sub = findActiveSubscriptionByWallet(PAYER, Date.now());
    expect(sub?.telegram_user_id).toBeNull();
  });
});

describe('issueGrantForSession idempotency', () => {
  it('returns null for a pending session', async () => {
    insertPendingSession();
    const result = await issueGrantForSession(SESSION_ID);
    expect(result).toBeNull();
  });

  it('mints a single grant code per confirmed session and reuses it on retry', async () => {
    const session = insertPendingSession();
    finalizeSession(session, 'txhash', PAYER);
    const first = await issueGrantForSession(SESSION_ID);
    const second = await issueGrantForSession(SESSION_ID);
    expect(first?.code).toBeDefined();
    expect(second?.code).toBe(first?.code);
  });
});

describe('createSession input validation', () => {
  it('rejects unknown tier', async () => {
    const result = await createSession({
      tier: 'whale' as 'pro',
      cadence: 'monthly',
      chain: 'ton',
      token: 'native',
      amountUsdCents: 999,
      discountBps: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.ok || result.reason).toBe('invalid_input');
  });

  it('rejects unknown cadence', async () => {
    const result = await createSession({
      tier: 'pro',
      cadence: 'weekly' as 'monthly',
      chain: 'ton',
      token: 'native',
      amountUsdCents: 999,
      discountBps: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_input');
  });

  it('rejects out-of-range amountUsdCents', async () => {
    const tooSmall = await createSession({
      tier: 'pro',
      cadence: 'monthly',
      chain: 'ton',
      token: 'native',
      amountUsdCents: 0,
      discountBps: 0,
    });
    expect(tooSmall.ok).toBe(false);
    if (!tooSmall.ok) expect(tooSmall.reason).toBe('invalid_input');

    const tooLarge = await createSession({
      tier: 'pro',
      cadence: 'monthly',
      chain: 'ton',
      token: 'native',
      amountUsdCents: 10_000_000,
      discountBps: 0,
    });
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) expect(tooLarge.reason).toBe('invalid_input');
  });

  it('rejects unsupported chain × token combos', async () => {
    const result = await createSession({
      tier: 'pro',
      cadence: 'monthly',
      chain: 'ton',
      token: 'vizzor',
      amountUsdCents: 999,
      discountBps: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_input');
  });
});
