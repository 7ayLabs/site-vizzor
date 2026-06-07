/**
 * Persistent signature replay cache for the Solana watcher.
 *
 * The watcher confirms incoming transfers by matching memo +
 * amount + treasury-as-destination. A short Solana reorg can replay
 * the same `tx_sig` against a *different* slot's view of the chain;
 * without this cache the watcher would re-credit the same payment
 * twice. The cache is the durable layer that survives both Node
 * restarts and reorgs.
 *
 * Wired in `lib/payment/watcher.ts`: every successful match is
 * guarded by `checkSignature()` first; on a hit the watcher skips
 * the finalize path entirely.
 *
 * Eviction policy: size-cap at `VIZZOR_REPLAY_CACHE_SIZE` (default
 * 4096) rows. When the cap is breached we drop the oldest 25% by
 * `seen_at`. Run from the daily retention sweep so the table doesn't
 * grow unbounded; size eviction is *also* called inline on every
 * insert so an under-resourced cron doesn't leak rows.
 *
 * Threat model: see `docs/rfc/v0.2.0/crypto-security.md` §6.1.
 */

import { getDb } from './db';

const SIZE_CAP_ENV = 'VIZZOR_REPLAY_CACHE_SIZE';
const DEFAULT_SIZE_CAP = 4096;

function sizeCap(): number {
  const raw = process.env[SIZE_CAP_ENV];
  if (raw === undefined || raw.length === 0) return DEFAULT_SIZE_CAP;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 256) return DEFAULT_SIZE_CAP;
  return Math.floor(n);
}

/**
 * Returns true if the signature has been seen before. Use **before**
 * calling `finalizeSession` so a reorg-induced replay is a no-op.
 */
export function checkSignature(signature: string): boolean {
  if (signature.length === 0) return false;
  const row = getDb()
    .prepare(`SELECT 1 FROM signature_replay_cache WHERE signature = ? LIMIT 1`)
    .get(signature);
  return row !== undefined;
}

/**
 * Record a signature as seen. Idempotent — a duplicate insert is a
 * no-op courtesy of the PRIMARY KEY. Trims the oldest 25% when the
 * row count crosses the cap so the table never grows unbounded.
 */
export function recordSignature(signature: string): void {
  if (signature.length === 0) return;
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO signature_replay_cache (signature) VALUES (?)`,
  ).run(signature);

  const cap = sizeCap();
  const countRow = db
    .prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM signature_replay_cache`)
    .get();
  const count = countRow?.c ?? 0;
  if (count <= cap) return;

  // Drop the oldest 25% — equivalent to a generational sweep so the
  // working set stays warm but we never grow past 1.25 × cap.
  const toDrop = Math.max(1, Math.floor(count / 4));
  db.prepare(
    `DELETE FROM signature_replay_cache
     WHERE signature IN (
       SELECT signature FROM signature_replay_cache
       ORDER BY seen_at ASC LIMIT ?
     )`,
  ).run(toDrop);
}
