/**
 * address-pool.ts — pre-derived address pool reader + atomic consumer.
 *
 * Covers the load-bearing seams:
 *   1. `loadPool` reads + validates JSON shape and per-entry address
 *      formats; throws with the env-var name on misconfig.
 *   2. `claimNext` consumes sequentially and never double-allocates
 *      under concurrent claims.
 *   3. Pool exhaustion is reported, not silently looped.
 *   4. Health snapshot exposes the low-watermark for ops alerts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claimNext,
  loadPool,
  poolHealth,
} from '@/lib/payment/address-pool';
import { getDb } from '@/lib/payment/db';

// A short pool of real-shape Solana base58 addresses (32-byte
// pubkeys derived from `solana-keygen`). Two entries → easy to test
// exhaustion in three calls.
const SOL_POOL_FIXTURE = [
  { index: 0, address: '11111111111111111111111111111112' },
  { index: 1, address: '11111111111111111111111111111113' },
];

// TON addresses in raw `workchain:hex` form. `Address.parse` accepts
// either friendly base64 (with checksum) or raw — raw is easier to
// fabricate for tests without a real keypair. Both entries are on
// workchain 0 with arbitrary 32-byte hex hashes.
const TON_POOL_FIXTURE = [
  {
    index: 0,
    address:
      '0:0000000000000000000000000000000000000000000000000000000000000001',
  },
  {
    index: 1,
    address:
      '0:0000000000000000000000000000000000000000000000000000000000000002',
  },
];

let tmpDir: string;
let solPoolPath: string;
let tonPoolPath: string;
let prevSolEnv: string | undefined;
let prevTonEnv: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'vizzor-pool-test-'));
  solPoolPath = join(tmpDir, 'sol-pool.json');
  tonPoolPath = join(tmpDir, 'ton-pool.json');
  writeFileSync(solPoolPath, JSON.stringify(SOL_POOL_FIXTURE));
  writeFileSync(tonPoolPath, JSON.stringify(TON_POOL_FIXTURE));
  prevSolEnv = process.env.VIZZOR_SOLANA_ADDRESS_POOL_PATH;
  prevTonEnv = process.env.VIZZOR_TON_ADDRESS_POOL_PATH;
  process.env.VIZZOR_SOLANA_ADDRESS_POOL_PATH = solPoolPath;
  process.env.VIZZOR_TON_ADDRESS_POOL_PATH = tonPoolPath;
  // Touch getDb() so the migrations run + pool_state rows exist
  // before the test starts claiming.
  getDb();
});

afterEach(() => {
  if (prevSolEnv === undefined) {
    delete process.env.VIZZOR_SOLANA_ADDRESS_POOL_PATH;
  } else {
    process.env.VIZZOR_SOLANA_ADDRESS_POOL_PATH = prevSolEnv;
  }
  if (prevTonEnv === undefined) {
    delete process.env.VIZZOR_TON_ADDRESS_POOL_PATH;
  } else {
    process.env.VIZZOR_TON_ADDRESS_POOL_PATH = prevTonEnv;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('address-pool loadPool', () => {
  it('reads + validates a well-formed Solana pool', () => {
    const pool = loadPool('solana');
    expect(pool.entries).toHaveLength(2);
    expect(pool.entries[0]?.address).toBe(SOL_POOL_FIXTURE[0]?.address);
    expect(typeof pool.sha256).toBe('string');
    expect(pool.sha256).toHaveLength(64);
  });

  it('reads + validates a well-formed TON pool', () => {
    const pool = loadPool('ton');
    expect(pool.entries).toHaveLength(2);
    expect(pool.entries[1]?.address).toBe(TON_POOL_FIXTURE[1]?.address);
  });

  it('throws with the env-var name when the env is unset', () => {
    delete process.env.VIZZOR_SOLANA_ADDRESS_POOL_PATH;
    expect(() => loadPool('solana')).toThrow(
      /VIZZOR_SOLANA_ADDRESS_POOL_PATH/,
    );
  });

  it('throws with the file path when the file is missing', () => {
    process.env.VIZZOR_SOLANA_ADDRESS_POOL_PATH = join(tmpDir, 'nope.json');
    expect(() => loadPool('solana')).toThrow(/nope\.json/);
  });

  it('throws when an entry address fails chain validation', () => {
    writeFileSync(
      solPoolPath,
      JSON.stringify([{ index: 0, address: 'not-a-real-address' }]),
    );
    expect(() => loadPool('solana')).toThrow(/solana address validation/);
  });

  it('throws when entry index is out of order', () => {
    writeFileSync(
      solPoolPath,
      JSON.stringify([
        { index: 0, address: SOL_POOL_FIXTURE[0]?.address },
        { index: 2, address: SOL_POOL_FIXTURE[1]?.address }, // wrong
      ]),
    );
    expect(() => loadPool('solana')).toThrow(/malformed/);
  });
});

describe('address-pool claimNext', () => {
  it('consumes sequentially, then throws pool_exhausted', () => {
    const first = claimNext('solana');
    expect(first).toEqual({ index: 0, address: SOL_POOL_FIXTURE[0]?.address });

    const second = claimNext('solana');
    expect(second).toEqual({ index: 1, address: SOL_POOL_FIXTURE[1]?.address });

    expect(() => claimNext('solana')).toThrow(/pool_exhausted/);
  });

  it('keeps SOL and TON pools independent', () => {
    claimNext('solana');
    claimNext('solana');
    // SOL exhausted, TON still has both entries.
    expect(() => claimNext('solana')).toThrow(/pool_exhausted/);
    const tonFirst = claimNext('ton');
    expect(tonFirst.index).toBe(0);
  });
});

describe('address-pool poolHealth', () => {
  it('reports remaining + lowWatermark accurately', () => {
    const before = poolHealth('solana');
    expect(before.size).toBe(2);
    expect(before.used).toBe(0);
    expect(before.remaining).toBe(2);
    // 2 < 32 → already in low-watermark territory for the fixture.
    expect(before.lowWatermark).toBe(true);

    claimNext('solana');
    const after = poolHealth('solana');
    expect(after.used).toBe(1);
    expect(after.remaining).toBe(1);
  });
});
