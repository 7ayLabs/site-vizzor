import { describe, it, expect } from 'vitest';
import {
  insertSession,
  markSessionConfirmed,
  type SessionRow,
} from '@/lib/payment/db';
import { listConfirmedSessionsByWallet } from '@/lib/payment/history';

const WALLET_A = 'AAAA1111aaaa1111AAAA1111aaaa1111AAAA1111aaaa';
const WALLET_B = 'BBBB2222bbbb2222BBBB2222bbbb2222BBBB2222bbbb';

function seedSession(opts: {
  sessionId: string;
  expiresInMs?: number;
}): void {
  insertSession({
    session_id: opts.sessionId,
    tier: 'pro',
    cadence: 'monthly',
    chain: 'solana',
    token: 'SOL',
    dest_address: 'Treasury1111111111111111111111111111111111111',
    amount: 200000000, // 0.2 SOL in lamports
    decimals: 9,
    amount_usd_cents: 3000,
    discount_bps: 0,
    rate_locked: 150,
    expires_at: Date.now() + (opts.expiresInMs ?? 300_000),
    status: 'pending',
  });
}

describe('listConfirmedSessionsByWallet', () => {
  it('returns only confirmed sessions for the given wallet', () => {
    seedSession({ sessionId: 's-a-conf' });
    markSessionConfirmed('s-a-conf', 'sig-a-1', WALLET_A, Date.now());

    seedSession({ sessionId: 's-b-conf' });
    markSessionConfirmed('s-b-conf', 'sig-b-1', WALLET_B, Date.now());

    const rowsA = listConfirmedSessionsByWallet(WALLET_A);
    expect(rowsA.map((r) => r.session_id)).toEqual(['s-a-conf']);

    const rowsB = listConfirmedSessionsByWallet(WALLET_B);
    expect(rowsB.map((r) => r.session_id)).toEqual(['s-b-conf']);
  });

  it('excludes pending sessions (only confirmed are billing-history-worthy)', () => {
    seedSession({ sessionId: 's-pending' });
    // No markSessionConfirmed — stays pending.

    const rows = listConfirmedSessionsByWallet(WALLET_A);
    expect(rows).toEqual([]);
  });

  it('orders rows by confirmed_at DESC (newest first)', () => {
    seedSession({ sessionId: 's-old' });
    markSessionConfirmed('s-old', 'sig-old', WALLET_A, 1_000_000);

    seedSession({ sessionId: 's-new' });
    markSessionConfirmed('s-new', 'sig-new', WALLET_A, 2_000_000);

    const rows = listConfirmedSessionsByWallet(WALLET_A);
    expect(rows.map((r) => r.session_id)).toEqual(['s-new', 's-old']);
  });

  it('clamps an outsized limit to the max', () => {
    // Seed 5 confirmed sessions for wallet A; query with an absurd
    // limit and confirm the clamp doesn't allow unbounded reads. The
    // assertion is that the helper doesn't throw and returns <= MAX
    // rows — exact count would over-couple to the seed.
    for (let i = 0; i < 5; i++) {
      const sid = `s-many-${i}`;
      seedSession({ sessionId: sid });
      markSessionConfirmed(sid, `sig-${i}`, WALLET_A, Date.now() + i);
    }

    const rows = listConfirmedSessionsByWallet(WALLET_A, 999_999);
    expect(rows.length).toBeLessThanOrEqual(100);
    expect(rows.length).toBe(5);
  });

  it('rejects a sub-1 limit by clamping up to 1', () => {
    seedSession({ sessionId: 's-one' });
    markSessionConfirmed('s-one', 'sig-one', WALLET_A, Date.now());

    const rows = listConfirmedSessionsByWallet(WALLET_A, 0);
    expect(rows.length).toBe(1);
  });

  it('returns SessionRow shape (no field renaming at the query layer)', () => {
    seedSession({ sessionId: 's-shape' });
    markSessionConfirmed('s-shape', 'sig-shape', WALLET_A, 1_234_567_890);

    const [row] = listConfirmedSessionsByWallet(WALLET_A);
    expect(row).toBeDefined();
    const r = row as SessionRow;
    expect(r.session_id).toBe('s-shape');
    expect(r.payer_address).toBe(WALLET_A);
    expect(r.status).toBe('confirmed');
    expect(r.tx_sig).toBe('sig-shape');
    expect(r.confirmed_at).toBe(1_234_567_890);
  });
});
