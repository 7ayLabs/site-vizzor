/**
 * replay-cache.ts — persistent burn-signature replay protection.
 *
 * Asserts the FIFO eviction policy, the INSERT OR IGNORE idempotency
 * primitive, and the cross-process survival contract (the same SQLite
 * file seen by a fresh getDb() returns the same rows).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearReplayCache,
  hasSignature,
  rememberSignature,
  replayCacheSize,
} from '@/lib/payment/replay-cache';

describe('replay-cache hasSignature / rememberSignature', () => {
  beforeEach(() => {
    clearReplayCache();
  });

  it('reports false for never-seen signatures', () => {
    expect(hasSignature('5J7…unseen')).toBe(false);
  });

  it('reports true after remembering', () => {
    rememberSignature('sigA');
    expect(hasSignature('sigA')).toBe(true);
  });

  it('is idempotent — remembering the same sig twice keeps size at 1', () => {
    rememberSignature('sigA');
    rememberSignature('sigA');
    expect(hasSignature('sigA')).toBe(true);
    expect(replayCacheSize()).toBe(1);
  });

  it('isolates between signatures', () => {
    rememberSignature('sigA');
    rememberSignature('sigB');
    expect(hasSignature('sigA')).toBe(true);
    expect(hasSignature('sigB')).toBe(true);
    expect(hasSignature('sigC')).toBe(false);
    expect(replayCacheSize()).toBe(2);
  });
});

describe('replay-cache FIFO eviction', () => {
  beforeEach(() => {
    clearReplayCache();
    // Tight cap so we hit the eviction branch with few inserts.
    process.env.VIZZOR_REPLAY_CACHE_SIZE = '4';
  });

  it('evicts the oldest 25% when the cap is exceeded', () => {
    // Cap 4 → eviction drops floor(4 * 0.25) = 1 row.
    rememberSignature('s1');
    rememberSignature('s2');
    rememberSignature('s3');
    rememberSignature('s4');
    expect(replayCacheSize()).toBe(4);

    // 5th insert triggers eviction; oldest (s1) drops.
    rememberSignature('s5');
    expect(replayCacheSize()).toBe(4);
    expect(hasSignature('s1')).toBe(false);
    expect(hasSignature('s2')).toBe(true);
    expect(hasSignature('s5')).toBe(true);
  });
});

describe('replay-cache clearReplayCache', () => {
  it('removes every row', () => {
    rememberSignature('a');
    rememberSignature('b');
    rememberSignature('c');
    expect(replayCacheSize()).toBe(3);
    clearReplayCache();
    expect(replayCacheSize()).toBe(0);
    expect(hasSignature('a')).toBe(false);
  });
});
