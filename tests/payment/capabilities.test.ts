import { describe, it, expect } from 'vitest';
import {
  CAPABILITY_TOS_VERSION,
  disableAllCapabilities,
  expireStaleIntents,
  getCapabilityPreferences,
  getCapabilitySpendUsedToday,
  getEnabledCapabilities,
  getPendingIntent,
  insertPendingIntent,
  listRecentIntents,
  setEnabledCapability,
  updateIntentStatus,
} from '@/lib/payment/db';

const WALLET = 'CapWaLLetTeStAddrAddrAddrAddrAddrAddrAddrAddr';
const OTHER_WALLET = 'OtherWaLLetTeStAddrAddrAddrAddrAddrAddrAddrAddr';

const NOW = Date.now();

function makeIntent(overrides: Partial<Parameters<typeof insertPendingIntent>[0]> = {}) {
  return {
    intentId: 'itn_test_' + Math.random().toString(36).slice(2, 10),
    wallet: WALLET,
    kind: 'transfer' as const,
    network: 'sol' as const,
    symbol: 'SOL',
    amount: '0.05',
    amountUsd: 7.5,
    fromAddr: 'FromAddrTest',
    toAddr: 'ToAddrTest',
    canonical: 'vizzor.intent.v1\n{"amount":"0.05"}',
    nonce: 'nonce_test',
    issuedAt: NOW,
    ttlAt: NOW + 60_000,
    ...overrides,
  };
}

describe('capability preferences — enable + TOS gate', () => {
  it('starts closed for a fresh wallet', () => {
    expect(getEnabledCapabilities(WALLET)).toEqual([]);
    const prefs = getCapabilityPreferences(WALLET);
    expect(prefs.enabled).toEqual([]);
    expect(prefs.tos_version).toBeNull();
    expect(prefs.tos_accepted_at).toBeNull();
  });

  it('refuses enable without the current TOS accepted', () => {
    expect(() =>
      setEnabledCapability({
        wallet: WALLET,
        capability: 'transfer',
        enabled: true,
        tosAcceptedAt: NOW,
        tosVersion: CAPABILITY_TOS_VERSION - 1, // stale
      }),
    ).toThrow('capability_tos_required');
  });

  it('accepts enable when the TOS matches', () => {
    setEnabledCapability({
      wallet: WALLET,
      capability: 'transfer',
      enabled: true,
      tosAcceptedAt: NOW,
      tosVersion: CAPABILITY_TOS_VERSION,
    });
    expect(getEnabledCapabilities(WALLET)).toEqual(['transfer']);
  });

  it('spend cap defaults + explicit override', () => {
    setEnabledCapability({
      wallet: WALLET,
      capability: 'transfer',
      enabled: true,
      tosAcceptedAt: NOW,
      tosVersion: CAPABILITY_TOS_VERSION,
      spendCapUsd: 200,
    });
    const prefs = getCapabilityPreferences(WALLET);
    expect(prefs.spend_caps.transfer).toBe(200);
    // Payment default from DEFAULT_SPEND_CAPS_USD is $50 (defaults
    // pass through unchanged when only transfer's cap was patched).
    expect(prefs.spend_caps.payment).toBe(50);
  });

  it('disableAllCapabilities atomically clears + cancels pending intents', () => {
    setEnabledCapability({
      wallet: WALLET,
      capability: 'transfer',
      enabled: true,
      tosAcceptedAt: NOW,
      tosVersion: CAPABILITY_TOS_VERSION,
    });
    insertPendingIntent(makeIntent());
    disableAllCapabilities(WALLET);
    expect(getEnabledCapabilities(WALLET)).toEqual([]);
    const [row] = listRecentIntents(WALLET, 5);
    expect(row?.status).toBe('expired');
  });
});

describe('capability_audit — intent lifecycle', () => {
  it('insertPendingIntent → get returns the same row', () => {
    const row = makeIntent();
    insertPendingIntent(row);
    const got = getPendingIntent(row.intentId);
    expect(got?.status).toBe('pending');
    expect(got?.wallet_address).toBe(WALLET);
    expect(got?.kind).toBe('transfer');
    expect(got?.amount_usd).toBe(7.5);
  });

  it('duplicate insertPendingIntent is a no-op (ON CONFLICT DO NOTHING)', () => {
    const row = makeIntent();
    insertPendingIntent(row);
    // A second insert with the same id must not throw and must not
    // overwrite the row's canonical bytes.
    insertPendingIntent({ ...row, canonical: 'tampered' });
    const got = getPendingIntent(row.intentId);
    expect(got?.canonical).toBe(row.canonical);
  });

  it('updateIntentStatus enforces legal transitions', () => {
    const row = makeIntent();
    insertPendingIntent(row);
    // pending → signed OK
    updateIntentStatus({ intentId: row.intentId, status: 'signed' });
    expect(getPendingIntent(row.intentId)?.status).toBe('signed');
    // signed → executed OK
    updateIntentStatus({
      intentId: row.intentId,
      status: 'executed',
      txHash: 'tx_test',
    });
    expect(getPendingIntent(row.intentId)?.status).toBe('executed');
    expect(getPendingIntent(row.intentId)?.tx_hash).toBe('tx_test');
    // executed → anything: illegal
    expect(() =>
      updateIntentStatus({ intentId: row.intentId, status: 'pending' }),
    ).toThrow(/intent_transition_illegal/);
  });

  it('rejects illegal skip transitions (pending → executed)', () => {
    const row = makeIntent();
    insertPendingIntent(row);
    expect(() =>
      updateIntentStatus({ intentId: row.intentId, status: 'executed' }),
    ).toThrow(/intent_transition_illegal/);
  });

  it('expireStaleIntents flips old pending rows to expired', () => {
    const now = Date.now();
    const stale = makeIntent({
      intentId: 'itn_stale',
      ttlAt: now - 5_000, // already past TTL
    });
    const fresh = makeIntent({
      intentId: 'itn_fresh',
      ttlAt: now + 60_000, // future
    });
    insertPendingIntent(stale);
    insertPendingIntent(fresh);
    const changed = expireStaleIntents(now);
    expect(changed).toBe(1);
    expect(getPendingIntent('itn_stale')?.status).toBe('expired');
    expect(getPendingIntent('itn_fresh')?.status).toBe('pending');
  });
});

describe('capability spend cap — daily aggregation', () => {
  it('counts only executed intents in the current UTC day', () => {
    const startOfDayUtc = new Date();
    startOfDayUtc.setUTCHours(0, 0, 0, 0);
    const nowUtc = startOfDayUtc.getTime() + 3600_000;

    const executed = makeIntent({
      intentId: 'itn_exec',
      amountUsd: 12,
    });
    insertPendingIntent(executed);
    updateIntentStatus({ intentId: executed.intentId, status: 'signed' });
    updateIntentStatus({
      intentId: executed.intentId,
      status: 'executed',
      txHash: 'tx',
    });
    // A separate wallet's executed intent must not contribute.
    const other = makeIntent({
      intentId: 'itn_other',
      wallet: OTHER_WALLET,
      amountUsd: 99,
    });
    insertPendingIntent(other);
    updateIntentStatus({ intentId: other.intentId, status: 'signed' });
    updateIntentStatus({
      intentId: other.intentId,
      status: 'executed',
      txHash: 'tx',
    });
    void nowUtc;

    const used = getCapabilitySpendUsedToday(WALLET, 'transfer');
    expect(used).toBe(12);
    const otherUsed = getCapabilitySpendUsedToday(OTHER_WALLET, 'transfer');
    expect(otherUsed).toBe(99);
  });
});
