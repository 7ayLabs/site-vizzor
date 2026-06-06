/**
 * Persistent burn-signature replay cache (v0.2.0).
 *
 * Replaces the in-memory Map<string, number> previously held inside
 * `lib/solana.ts`. The eviction policy is preserved exactly: cap at
 * `REPLAY_CACHE_SIZE` rows, drop the oldest 25% in one statement when
 * the insert pushes us over the cap. Eviction is keyed off `seen_at`
 * ASC so the FIFO contract matches the legacy LRU's behavior on the
 * insert side (we never had read-time promotion, so this is the same
 * order users observe).
 *
 * Why persistent: a Node process restart used to wipe the in-memory
 * Map, which re-opened the on-chain 5-minute replay window for any
 * signature that was burned in the last 300s. The SQLite-backed cache
 * survives restarts. Backwards-compatible: a fresh deployment with no
 * rows behaves identically to a fresh in-memory cache, just with a
 * starting size of 0 and no replay history yet (which is acceptable
 * because the on-chain blockTime check still gates the 5-minute
 * window).
 *
 * Schema (added to `runV020Migrations` in `lib/payment/db.ts`):
 *
 *   CREATE TABLE IF NOT EXISTS signature_replay_cache (
 *     signature  TEXT PRIMARY KEY,
 *     seen_at    INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
 *   );
 *   CREATE INDEX IF NOT EXISTS idx_replay_seen_at
 *     ON signature_replay_cache(seen_at);
 *
 * Concurrency: better-sqlite3 is synchronous; the insert + evict are
 * a single logical pair guarded by `INSERT OR IGNORE`, so the worst
 * case under concurrent verify calls is two harmless retries. The
 * UNIQUE PK guarantees idempotency.
 */

import { getDb } from './db';

const DEFAULT_LIMIT = 4096;

function replayCacheLimit(): number {
  const raw = process.env.VIZZOR_REPLAY_CACHE_SIZE;
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIT;
}

/**
 * Returns true if the signature has been remembered previously.
 * Constant-time-equivalent O(log n) primary-key lookup.
 */
export function hasSignature(sig: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 AS hit FROM signature_replay_cache WHERE signature = ?`,
    )
    .get(sig) as { hit?: number } | undefined;
  return !!row?.hit;
}

/**
 * Remembers the signature. If the cache exceeds its configured cap,
 * drops the oldest 25% to amortize the eviction cost (matches the
 * legacy in-memory policy in lib/solana.ts).
 *
 * `INSERT OR IGNORE` is the idempotency primitive: a concurrent insert
 * of the same signature is a no-op, never an error.
 */
export function rememberSignature(sig: string): void {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO signature_replay_cache (signature) VALUES (?)`,
  ).run(sig);

  const limit = replayCacheLimit();
  const { count } = db
    .prepare(`SELECT COUNT(*) AS count FROM signature_replay_cache`)
    .get() as { count: number };

  if (count > limit) {
    const drop = Math.floor(limit * 0.25);
    db.prepare(
      `DELETE FROM signature_replay_cache
       WHERE signature IN (
         SELECT signature FROM signature_replay_cache
         ORDER BY seen_at ASC
         LIMIT ?
       )`,
    ).run(drop);
  }
}

/**
 * Test/ops helper. Removes all rows. NOT exposed via any HTTP route.
 * Used by the test harness in C5; do not call from production code.
 */
export function clearReplayCache(): void {
  getDb().prepare(`DELETE FROM signature_replay_cache`).run();
}

/**
 * Test/ops helper. Returns the current row count.
 */
export function replayCacheSize(): number {
  const { count } = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM signature_replay_cache`)
    .get() as { count: number };
  return count;
}
