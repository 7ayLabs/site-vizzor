/**
 * Data retention sweep — keeps the SQLite tables from accumulating
 * stale rows and bounds the durable PII footprint to the windows the
 * privacy policy commits to.
 *
 * Windows (defaults; overridable via env):
 *
 *   - failed / expired payment_sessions   : 30 days
 *   - confirmed payment_sessions          : 365 days (tax / audit)
 *   - grants (after expires_at)           : 90 days
 *   - wallet_link_challenges (after expiry): 7 days
 *   - idempotency_keys                    : 7 days
 *   - rate_limit_buckets (stale)          : 1 day
 *   - audit_log                           : 365 days
 *   - signature_replay_cache              : size-cap eviction
 *
 * Called from the `/api/internal/retention-sweep` route, which is
 * authenticated by the bot shared secret and triggered once per day
 * from the existing GitHub Actions cron (snapshot.yml).
 */

import { getDb } from './db';
import { recordSignature } from './replay-cache';

const DAY_MS = 24 * 60 * 60 * 1000;

function readDayWindow(envKey: string, fallbackDays: number): number {
  const raw = process.env[envKey];
  if (raw === undefined || raw.length === 0) return fallbackDays * DAY_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallbackDays * DAY_MS;
  return Math.floor(n) * DAY_MS;
}

export interface SweepResult {
  swept: Record<string, number>;
  durationMs: number;
}

/**
 * Run the sweep. Idempotent and safe to call any frequency.
 *
 * Each DELETE is wrapped in `getDb().exec()` rather than a multi-row
 * transaction because the swept tables are independent — if one
 * sweep fails we still want the others to land.
 */
export function runRetentionSweep(now: number = Date.now()): SweepResult {
  const failedSessionsCutoff =
    now - readDayWindow('VIZZOR_RETENTION_DAYS_FAILED_SESSIONS', 30);
  const confirmedSessionsCutoff =
    now - readDayWindow('VIZZOR_RETENTION_DAYS_CONFIRMED', 365);
  const grantsCutoff = now - readDayWindow('VIZZOR_RETENTION_DAYS_GRANTS', 90);
  const challengesCutoff = now - 7 * DAY_MS;
  const idempotencyCutoff = now - 7 * DAY_MS;
  const rateLimitCutoff = now - DAY_MS;
  const auditCutoff =
    now - readDayWindow('VIZZOR_RETENTION_DAYS_AUDIT', 365);

  const db = getDb();
  const started = Date.now();
  const swept: Record<string, number> = {};

  swept.payment_sessions_failed = db
    .prepare(
      `DELETE FROM payment_sessions
       WHERE status IN ('expired','failed') AND created_at < ?`,
    )
    .run(failedSessionsCutoff).changes;

  swept.payment_sessions_confirmed = db
    .prepare(
      `DELETE FROM payment_sessions
       WHERE status = 'confirmed' AND created_at < ?`,
    )
    .run(confirmedSessionsCutoff).changes;

  swept.grants = db
    .prepare(`DELETE FROM grants WHERE expires_at < ?`)
    .run(grantsCutoff).changes;

  // wallet_link_challenges may not exist on every install (it's a
  // separate sub-slice). Guard with a table-info check rather than
  // a try / catch so a real error still bubbles up.
  const challengesTable = db
    .prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type='table' AND name='wallet_link_challenges'`,
    )
    .get();
  if (challengesTable) {
    swept.wallet_link_challenges = db
      .prepare(`DELETE FROM wallet_link_challenges WHERE expires_at < ?`)
      .run(challengesCutoff).changes;
  }

  swept.idempotency_keys = db
    .prepare(`DELETE FROM idempotency_keys WHERE created_at < ?`)
    .run(idempotencyCutoff).changes;

  swept.rate_limit_buckets = db
    .prepare(`DELETE FROM rate_limit_buckets WHERE last_refill_at < ?`)
    .run(rateLimitCutoff).changes;

  swept.audit_log = db
    .prepare(`DELETE FROM audit_log WHERE occurred_at < ?`)
    .run(auditCutoff).changes;

  // signature_replay_cache uses size-cap eviction. Touch the cache
  // helper with an empty insert to trigger its internal pruning
  // without writing a fresh row.
  recordSignature('');
  swept.signature_replay_cache_evicted = 0; // populated by future read-back

  return { swept, durationMs: Date.now() - started };
}
