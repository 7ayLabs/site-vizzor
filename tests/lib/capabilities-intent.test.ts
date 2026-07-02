import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {
  buildCanonicalIntent,
  buildIntentPrimingMessages,
  parsePendingIntent,
  shortAddress,
  isCapId,
  isIntentNetwork,
  type PendingIntent,
} from '@/lib/capabilities/intent';

/**
 * The canonicalization + signature contract is the security boundary
 * of the whole agent-payment surface. If two callers produce
 * different bytes for the same intent, or an unknown field silently
 * survives the parser, the wallet prompt is showing something the
 * server does not verify. Every test in this file locks a specific
 * invariant that keeps that boundary honest.
 */

function makeIntent(overrides: Partial<PendingIntent> = {}): PendingIntent {
  return {
    intent_id: 'itn_test_0123456789abcdef',
    kind: 'transfer',
    network: 'sol',
    from_addr: 'AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMn',
    to_addr: 'ZyXwVuTsRqPoNmLkJiHgFeDcBaZyXwVuTsRqPoNm',
    symbol: 'SOL',
    amount: '0.05',
    nonce: 'nonce_9876543210fedcba',
    ttl_at: 1_700_000_060_000,
    issued_at: 1_700_000_000_000,
    ...overrides,
  };
}

describe('buildCanonicalIntent — determinism', () => {
  it('produces byte-identical output across 100 runs', () => {
    const intent = makeIntent();
    const first = buildCanonicalIntent(intent);
    for (let i = 0; i < 100; i++) {
      expect(buildCanonicalIntent(intent)).toBe(first);
    }
  });

  it('produces the same output regardless of input key order', () => {
    const a = makeIntent();
    // Rebuild by re-inserting keys in a scrambled order.
    const scrambled: PendingIntent = {
      ttl_at: a.ttl_at,
      symbol: a.symbol,
      nonce: a.nonce,
      network: a.network,
      to_addr: a.to_addr,
      kind: a.kind,
      issued_at: a.issued_at,
      intent_id: a.intent_id,
      from_addr: a.from_addr,
      amount: a.amount,
    };
    expect(buildCanonicalIntent(scrambled)).toBe(buildCanonicalIntent(a));
  });

  it('starts with the domain-separator prefix', () => {
    const s = buildCanonicalIntent(makeIntent());
    expect(s.startsWith('vizzor.intent.v1\n')).toBe(true);
  });

  it('excludes network_fee even when provided', () => {
    const withFee = buildCanonicalIntent(
      makeIntent({ network_fee: '0.000005' }),
    );
    const without = buildCanonicalIntent(makeIntent());
    // Fee is display-only; canonical must remain stable so a fee
    // estimate change never invalidates a signature.
    expect(withFee).toBe(without);
  });
});

describe('parsePendingIntent — accept + reject', () => {
  it('accepts a fully-formed intent', () => {
    const raw = makeIntent();
    expect(parsePendingIntent(raw)).toEqual(raw);
  });

  it('rejects unknown fields ("unknown field → refuse to sign")', () => {
    const evil = { ...makeIntent(), extra_field: 'lol' };
    expect(parsePendingIntent(evil)).toBeNull();
  });

  it('rejects missing required fields', () => {
    for (const key of [
      'intent_id',
      'kind',
      'network',
      'from_addr',
      'to_addr',
      'symbol',
      'amount',
      'nonce',
      'ttl_at',
      'issued_at',
    ] as const) {
      const missing = { ...makeIntent() } as Record<string, unknown>;
      delete missing[key];
      expect(parsePendingIntent(missing)).toBeNull();
    }
  });

  it('rejects an invalid amount (float mismatch or non-decimal)', () => {
    expect(parsePendingIntent(makeIntent({ amount: '1.2.3' }))).toBeNull();
    expect(parsePendingIntent(makeIntent({ amount: 'abc' }))).toBeNull();
    expect(parsePendingIntent(makeIntent({ amount: '-5' }))).toBeNull();
  });

  it('rejects an unknown kind or unknown network', () => {
    expect(
      parsePendingIntent({ ...makeIntent(), kind: 'yolo' }),
    ).toBeNull();
    expect(
      parsePendingIntent({ ...makeIntent(), network: 'eth' }),
    ).toBeNull();
  });

  it('accepts an optional network_fee decimal', () => {
    const intent = parsePendingIntent(
      makeIntent({ network_fee: '0.0001' }),
    );
    expect(intent?.network_fee).toBe('0.0001');
  });
});

describe('signature verification — ed25519 round trip', () => {
  it('verifies a signature over the canonical bytes', () => {
    const kp = nacl.sign.keyPair();
    const walletAddr = bs58.encode(kp.publicKey);
    const intent = makeIntent({ from_addr: walletAddr });
    const canonical = buildCanonicalIntent(intent);
    const msg = new TextEncoder().encode(canonical);
    const sig = nacl.sign.detached(msg, kp.secretKey);
    const ok = nacl.sign.detached.verify(msg, sig, kp.publicKey);
    expect(ok).toBe(true);
  });

  it('rejects a signature over a tampered canonical form', () => {
    const kp = nacl.sign.keyPair();
    const intent = makeIntent({ from_addr: bs58.encode(kp.publicKey) });
    const canonical = buildCanonicalIntent(intent);
    const sig = nacl.sign.detached(
      new TextEncoder().encode(canonical),
      kp.secretKey,
    );
    // Attacker flips amount 0.05 → 5.00 but tries to reuse the sig.
    const tampered = buildCanonicalIntent({ ...intent, amount: '5.00' });
    const ok = nacl.sign.detached.verify(
      new TextEncoder().encode(tampered),
      sig,
      kp.publicKey,
    );
    expect(ok).toBe(false);
  });
});

describe('helpers', () => {
  it('shortAddress elides the middle', () => {
    expect(shortAddress('abcdefghijklmnopqrstuvwxyz')).toBe('abcd…wxyz');
    expect(shortAddress('short')).toBe('short');
  });
  it('isCapId narrows to CapId', () => {
    expect(isCapId('transfer')).toBe(true);
    expect(isCapId('payment')).toBe(true);
    expect(isCapId('workflow')).toBe(false);
    expect(isCapId('autonomous')).toBe(false);
    expect(isCapId('unknown')).toBe(false);
  });
  it('isIntentNetwork narrows to IntentNetwork', () => {
    expect(isIntentNetwork('sol')).toBe(true);
    expect(isIntentNetwork('ton')).toBe(true);
    expect(isIntentNetwork('eth')).toBe(false);
  });
});

describe('buildIntentPrimingMessages — trust-model pin', () => {
  it('returns an empty array when no intents are queued', () => {
    expect(buildIntentPrimingMessages([])).toEqual([]);
  });

  it('emits a user + assistant priming pair when intents are present', () => {
    const msgs = buildIntentPrimingMessages([
      {
        intent_id: 'itn_abc',
        kind: 'transfer',
        symbol: 'SOL',
        amount: '0.1',
        to_addr: 'ZyXwVuTsRqPoNmLkJiHgFeDcBaZyXwVuTsRqPoNm',
      },
    ]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe('user');
    expect(msgs[1]?.role).toBe('assistant');
  });

  it('pins the trust-model contract the engine LLM must obey', () => {
    // The 2026-07 regression: engine refused a `send 0.1 SOL → …`
    // command with "no wallet provisioned / paper trading" language.
    // These assertions lock the forbidden-refusal clauses in place so
    // a copy edit can't silently drop them and reopen the regression.
    const [userMsg] = buildIntentPrimingMessages([
      {
        intent_id: 'itn_abc',
        kind: 'transfer',
        symbol: 'SOL',
        amount: '0.1',
        to_addr: 'ZyXwVuTsRqPoNmLkJiHgFeDcBaZyXwVuTsRqPoNm',
      },
    ]);
    const content = userMsg?.content ?? '';
    expect(content).toContain('INTENT_EXECUTION_MODEL: user_wallet_siws');
    expect(content).toContain('paper trading');
    expect(content).toContain('No wallet provisioned');
    expect(content).toContain('MUST NOT');
  });

  it('lists every queued intent with a shortened recipient', () => {
    const [userMsg] = buildIntentPrimingMessages([
      {
        intent_id: 'itn_one',
        kind: 'transfer',
        symbol: 'SOL',
        amount: '0.1',
        to_addr: 'AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMn',
      },
      {
        intent_id: 'itn_two',
        kind: 'payment',
        symbol: 'USDC',
        amount: '25',
        to_addr: 'ZyXwVuTsRqPoNmLkJiHgFeDcBaZyXwVuTsRqPoNm',
      },
    ]);
    const content = userMsg?.content ?? '';
    expect(content).toContain('[itn_one]');
    expect(content).toContain('[itn_two]');
    expect(content).toContain('AbCd…KlMn');
    expect(content).toContain('ZyXw…RqPoNm'.slice(0, 4) + '…');
  });
});
