/**
 * Pre-derived address pool — watch-only HD treasury.
 *
 * The cypherpunk-correct payment model: every paying customer gets a
 * unique receive address. The server holds the PUBLIC addresses only;
 * the operator derives them on a hardware wallet (offline) and uploads
 * a JSON file with `{ index, address }` entries. The server consumes
 * them one-per-session via `claimNext()`, atomically inside the same
 * SQLite transaction as the session insert so concurrent claims never
 * double-allocate.
 *
 * Privacy property: an outside observer who sees one customer's
 * payment can only see THAT customer's tx into THAT address —
 * never the aggregate treasury balance, never the customer set.
 * The operator can later consolidate via the cold device, but the
 * on-chain link to the customer set is post-hoc and operator-timed.
 *
 * Security property: the server has zero ability to sign. Even a
 * full VPS compromise yields no fund movement. Seed lives only on
 * the operator's hardware wallet, backed up to steel plates in two
 * geographic locations (see `docs/ops/treasury-setup.md`).
 *
 * Why we run this for BOTH chains (instead of HD-on-server for TON):
 * `@ton/crypto` only exposes hardened ED25519 derivation from a SEED,
 * not from a public key — so true xpub-style watch-only HD is
 * impossible for TON the same way it is for Solana. The
 * pre-derived-pool model gives us the same address-freshness
 * guarantee without ever putting a private key on the VPS.
 */

import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
// @ton/core is a transitive of @ton/ton; importing through the
// umbrella avoids adding a direct dependency.
import { Address as TonAddress } from '@ton/ton';
import {
  type PoolChain,
  claimNextPoolIndex,
  getPoolNextIndex,
} from './db';

interface PoolEntry {
  index: number;
  address: string;
}

interface PoolCache {
  entries: PoolEntry[];
  mtimeMs: number;
  /** sha256 of the file bytes at load. A tamper check at startup +
   *  on every reload logs an audit line when this changes. */
  sha256: string;
}

const POOL_LOW_WATERMARK = 32;
const POOL_PATH_ENV: Record<PoolChain, string> = {
  solana: 'VIZZOR_SOLANA_ADDRESS_POOL_PATH',
  ton: 'VIZZOR_TON_ADDRESS_POOL_PATH',
};
/**
 * Operator records the sha256 of the pool file out-of-band (in a
 * password manager, NOT in git) and configures these env vars. Boot
 * refuses to start if the on-disk sha256 doesn't match — a VPS-shell
 * attacker who swaps the file to attacker-controlled addresses would
 * change the digest, so this gate makes the swap fail loudly instead
 * of silently redirecting the next 256 customer payments. The gate is
 * opt-in (empty env → no check) so the dev / CI flow that uses an
 * inline test pool isn't blocked; production MUST set it.
 */
const POOL_SHA256_ENV: Record<PoolChain, string> = {
  solana: 'VIZZOR_SOLANA_POOL_SHA256',
  ton: 'VIZZOR_TON_POOL_SHA256',
};
/** When MODE_GATE=true, the pool file must have no group/world bits
 *  (mode 0400 / 0600 / etc.). A pool file with 0644 perms means any
 *  process on the host can read it — the addresses are public so this
 *  is mild, but it signals an opsec drift the operator should fix.
 *  Refusing to start surfaces it immediately. Defaults ON in
 *  production, OFF elsewhere so dev / CI fixtures with default umask
 *  permissions don't break. Force via `VIZZOR_POOL_MODE_GATE=true|false`. */
function poolModeGateEnabled(): boolean {
  const override = process.env.VIZZOR_POOL_MODE_GATE;
  if (override === 'true') return true;
  if (override === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

const cache = new Map<PoolChain, PoolCache>();

/**
 * Validates that `addr` is a real public address on `chain`. Throws
 * with a descriptive message including the bad address + chain on
 * failure so audit logs name the exact pool entry that's malformed.
 */
function validateAddress(chain: PoolChain, addr: string): void {
  if (chain === 'solana') {
    // PublicKey throws on non-base58 or wrong byte length. The 32-byte
    // length is enforced inside the constructor.
    new PublicKey(addr);
    return;
  }
  // TON: parse handles both raw (`0:hex`) and friendly (`UQ.../EQ...`)
  // forms. Throws on anything else.
  TonAddress.parse(addr);
}

/**
 * Read + cache the pool file for `chain`. Re-reads when the file's
 * mtime advances (operator refilled the pool out-of-band) and emits
 * an audit log line on every reload so a VPS-shell attacker who
 * swaps the file leaves a fingerprint.
 *
 * Throws when:
 *   - The env var pointing at the pool file is unset
 *   - The file is missing
 *   - The JSON is malformed
 *   - Any entry's address fails chain-specific validation
 */
export function loadPool(chain: PoolChain): PoolCache {
  const envName = POOL_PATH_ENV[chain];
  const path = process.env[envName];
  if (!path) {
    throw new Error(
      `[address-pool] ${envName} is not set — operator must upload a pre-derived address pool. See docs/ops/treasury-setup.md.`,
    );
  }
  let stat;
  try {
    stat = statSync(path);
  } catch (e) {
    throw new Error(
      `[address-pool] cannot read ${envName}=${path}: ${(e as Error).message}`,
    );
  }
  // Mode gate — refuse to load a pool file with permissive bits set.
  // The Unix `mode & 0o077` mask covers group + other read/write/exec.
  // Default-on in production; toggle via VIZZOR_POOL_MODE_GATE=false
  // for local dev with a checked-in fixture.
  if (poolModeGateEnabled() && (stat.mode & 0o077) !== 0) {
    throw new Error(
      `[address-pool] ${path} has permissive permissions (mode ${(stat.mode & 0o7777).toString(8)}) — must be 0400 or 0600 (no group/world bits). Run: sudo chmod 0400 ${path}`,
    );
  }
  const hit = cache.get(chain);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit;

  const raw = readFileSync(path, 'utf8');
  const sha256 = createHash('sha256').update(raw).digest('hex');

  // Expected-digest gate — operator records the sha256 of the canonical
  // pool out-of-band. Boot refuses to start on a mismatch. Empty env =
  // no check (dev / CI). Production prod env file MUST set this.
  const expected = process.env[POOL_SHA256_ENV[chain]];
  if (expected && expected.trim() !== sha256) {
    throw new Error(
      `[address-pool] ${path} sha256 mismatch — expected ${POOL_SHA256_ENV[chain]}=${expected.trim().slice(0, 16)}…, on-disk ${sha256.slice(0, 16)}…. POSSIBLE TAMPER — refusing to load. Verify the operator-recorded digest before restarting.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `[address-pool] ${envName}=${path} is not valid JSON: ${(e as Error).message}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `[address-pool] ${envName}=${path} must be a JSON array of { index, address }`,
    );
  }
  const entries: PoolEntry[] = [];
  for (let i = 0; i < parsed.length; i += 1) {
    const row = parsed[i] as { index?: unknown; address?: unknown };
    const index = typeof row?.index === 'number' ? row.index : null;
    const address = typeof row?.address === 'string' ? row.address : null;
    if (index === null || address === null || index !== i) {
      throw new Error(
        `[address-pool] ${path} entry ${i} malformed (expected { index: ${i}, address: "..." }, got ${JSON.stringify(row)})`,
      );
    }
    try {
      validateAddress(chain, address);
    } catch (e) {
      throw new Error(
        `[address-pool] ${path} entry ${i} (${address}) failed ${chain} address validation: ${(e as Error).message}`,
      );
    }
    entries.push({ index, address });
  }

  if (hit && hit.sha256 !== sha256) {
    // Tamper / reload audit line. Operator refills produce this on
    // purpose; an attacker swap produces it too — log so the
    // operator can grep for unexpected reloads.
    // eslint-disable-next-line no-console
    console.warn(
      `[address-pool] ${chain} pool reloaded (sha256 ${hit.sha256.slice(0, 16)}... → ${sha256.slice(0, 16)}..., size ${entries.length})`,
    );
  } else if (!hit) {
    // eslint-disable-next-line no-console
    console.info(
      `[address-pool] ${chain} pool loaded from ${path} (size ${entries.length}, sha256 ${sha256.slice(0, 16)}...)`,
    );
  }

  const fresh: PoolCache = { entries, mtimeMs: stat.mtimeMs, sha256 };
  cache.set(chain, fresh);
  return fresh;
}

export interface ClaimedAddress {
  index: number;
  address: string;
}

/**
 * Atomically claim the next address from the pool for `chain`.
 * Throws `pool_exhausted` when the pool is empty.
 *
 * Idempotency: the caller (createSession) inserts the session row in
 * the same SQLite write window. If the insert fails, the index is
 * "consumed" but unused — acceptable since pools are sized 10× the
 * expected failure rate and the operator refills before the
 * low-watermark probe fires.
 */
export function claimNext(chain: PoolChain): ClaimedAddress {
  const pool = loadPool(chain);
  if (pool.entries.length === 0) {
    throw new Error(`pool_exhausted: ${chain} pool is empty`);
  }
  const claimed = claimNextPoolIndex(chain);
  if (claimed >= pool.entries.length) {
    throw new Error(
      `pool_exhausted: ${chain} claim index ${claimed} >= pool size ${pool.entries.length}`,
    );
  }
  const entry = pool.entries[claimed];
  if (!entry) {
    throw new Error(
      `pool_exhausted: ${chain} entry at index ${claimed} unexpectedly missing`,
    );
  }
  return { index: entry.index, address: entry.address };
}

export interface PoolHealth {
  size: number;
  used: number;
  remaining: number;
  lowWatermark: boolean;
}

/**
 * Snapshot of pool health for `/api/health`. `lowWatermark` is the
 * operator's signal to refill — fire at < 32 remaining so they have
 * lead time before exhaustion.
 */
export function poolHealth(chain: PoolChain): PoolHealth {
  let size = 0;
  try {
    size = loadPool(chain).entries.length;
  } catch {
    // Pool unloadable — surfaced separately by the audit health
    // probe; here we report a zero pool so the low-watermark always
    // fires on misconfig.
  }
  const used = getPoolNextIndex(chain);
  const remaining = Math.max(0, size - used);
  return {
    size,
    used,
    remaining,
    lowWatermark: remaining < POOL_LOW_WATERMARK,
  };
}
