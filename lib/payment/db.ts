/**
 * Site-owned subscription database.
 *
 * SQLite-backed. The data model is identical to a Postgres schema —
 * migrating later is a `pg_dump | psql` exercise. We keep state on the
 * site so:
 *   1. /pay/* doesn't depend on engine endpoints that haven't shipped
 *   2. /predict can resolve subscription state by wallet without a
 *      round-trip to a remote service
 *   3. The watcher daemon (lib/payment/watcher.ts) can run in-process
 *
 * Tables:
 *   - payment_sessions  : pending + confirmed on-chain payments
 *   - subscriptions     : the canonical "is wallet X subscribed?" record
 *   - grants            : single-use codes for binding TG users
 *   - auth_sessions     : SIWS-derived browser sessions (wallet-based login)
 *   - wallet_links      : (v0.2.0) durable bindings of a Solana wallet to a
 *                         Telegram user id. 1:1 in both directions enforced
 *                         by UNIQUE indexes. Populated by grant redemption
 *                         and by SIWS-signed pre-link from the bot flow.
 *
 * v0.2.0 migrations are additive only and idempotent. They run inside
 * `init()` after the base DDL. SQLite has no `ADD COLUMN IF NOT EXISTS`,
 * so each ALTER is guarded by an introspection check via the
 * `addColumnIfMissing` helper. Rollback is a redeploy of the prior image
 * tag with the unchanged on-disk DB; older code paths ignore the new
 * columns and the new table because they never reference them.
 *
 * Connection is a singleton; safe under Next.js dev HMR because we
 * stash it on globalThis with a typed symbol.
 */

import Database, { type Database as DB } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DB_PATH =
  process.env.VIZZOR_SITE_DB ?? join(process.cwd(), '.vizzor', 'site.db');

const KEY = Symbol.for('vizzor.site.db');
interface GlobalWithDB {
  [KEY]?: DB;
}
const g = globalThis as unknown as GlobalWithDB;

function init(): DB {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_sessions (
      session_id        TEXT PRIMARY KEY,
      tier              TEXT NOT NULL,
      cadence           TEXT NOT NULL,
      chain             TEXT NOT NULL,
      token             TEXT NOT NULL,
      dest_address      TEXT NOT NULL,
      amount            REAL NOT NULL,
      decimals          INTEGER NOT NULL,
      amount_usd_cents  INTEGER NOT NULL,
      discount_bps      INTEGER NOT NULL,
      rate_locked       REAL NOT NULL,
      expires_at        INTEGER NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending',
      tx_sig            TEXT,
      confirmed_at      INTEGER,
      payer_address     TEXT,
      grant_code        TEXT,
      memo              TEXT,
      created_at        INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_status_expires
      ON payment_sessions(status, expires_at);

    CREATE TABLE IF NOT EXISTS subscriptions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_address    TEXT NOT NULL,
      tier              TEXT NOT NULL,
      cadence           TEXT NOT NULL,
      expires_at        INTEGER,
      session_id        TEXT,
      created_at        INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      FOREIGN KEY (session_id) REFERENCES payment_sessions(session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_subs_wallet ON subscriptions(wallet_address);

    CREATE TABLE IF NOT EXISTS grants (
      code              TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL,
      created_at        INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      expires_at        INTEGER NOT NULL,
      redeemed_by       INTEGER,
      redeemed_at       INTEGER,
      FOREIGN KEY (session_id) REFERENCES payment_sessions(session_id)
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token             TEXT PRIMARY KEY,
      wallet_address    TEXT NOT NULL,
      created_at        INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      expires_at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_wallet ON auth_sessions(wallet_address);

    /* v0.2.0 — C1 web3-purchase-flow additions. Additive only. */
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key               TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL,
      created_at        INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      FOREIGN KEY (session_id) REFERENCES payment_sessions(session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_idempotency_created
      ON idempotency_keys(created_at);

    CREATE TABLE IF NOT EXISTS rate_cache (
      token             TEXT PRIMARY KEY,
      usd_per           REAL NOT NULL,
      fetched_at        INTEGER NOT NULL,
      source            TEXT NOT NULL
    );
  `);
  runV020Migrations(db);
  return db;
}

/* ------------------------------------------------------------------ *\
 * v0.2.0 migrations — additive only. See RFC §3.
\* ------------------------------------------------------------------ */

/**
 * Returns true if `table.column` exists, false otherwise. Uses the
 * sqlite `PRAGMA table_info(...)` introspection. Tables that do not
 * exist also return false (callers should never reach this with an
 * unknown table because the base DDL above creates them first).
 */
function hasColumn(db: DB, table: string, column: string): boolean {
  // PRAGMA arguments cannot be bound parameters; the table name must
  // be interpolated. We restrict to the small known-static set of
  // table names we own, so this is safe in practice.
  const rows = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

/**
 * Idempotent helper. Runs `ALTER TABLE <table> ADD COLUMN <column>
 * <definition>` only when the column is not already present. Used to
 * back-fill columns onto pre-v0.2.0 databases without a destructive
 * migration. SQLite does not support `ADD COLUMN IF NOT EXISTS` so the
 * guard lives in code.
 */
export function addColumnIfMissing(
  db: DB,
  table: string,
  column: string,
  definition: string,
): void {
  if (hasColumn(db, table, column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function runV020Migrations(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_links (
      telegram_user_id  INTEGER NOT NULL,
      wallet_address    TEXT    NOT NULL,
      linked_at         INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      siws_token        TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_links_telegram
      ON wallet_links(telegram_user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_links_wallet
      ON wallet_links(wallet_address);
  `);
  addColumnIfMissing(db, 'subscriptions', 'telegram_user_id', 'INTEGER');
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_subs_telegram ON subscriptions(telegram_user_id)`,
  );
  addColumnIfMissing(db, 'auth_sessions', 'telegram_user_id', 'INTEGER');

  // Persistent burn-signature replay cache. Replaces the in-memory
  // LRU previously held inside lib/solana.ts. Eviction policy is the
  // same: cap at VIZZOR_REPLAY_CACHE_SIZE (default 4096) rows, drop
  // the oldest 25% by `seen_at` when over the cap. See RFC
  // docs/rfc/v0.2.0/crypto-security.md §6.1 for the threat model.
  // The table is additive; a fresh deploy with no rows behaves
  // identically to a fresh in-memory cache. (C4 owns this table.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS signature_replay_cache (
      signature  TEXT PRIMARY KEY,
      seen_at    INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_replay_seen_at
      ON signature_replay_cache(seen_at);
  `);

  // v0.2.x security slice — auth-token-hash migration (Layer B1).
  //
  // The auth_sessions.token column flipped semantics: it now stores
  // SHA-256(rawToken) in 64 hex chars instead of the raw base64url
  // 43-char token. Any existing row written before this deploy has
  // length 43 and is unusable for the new lookup path — the user is
  // forced to re-sign in once. We sweep those rows here.
  //
  // Idempotent: after the first boot every remaining row has length
  // 64, so subsequent boots delete zero rows.
  db.exec(
    `DELETE FROM auth_sessions WHERE length(token) <> 64 OR token GLOB '*[^0-9a-f]*'`,
  );

  // v0.2.x security slice — per-IP token-bucket rate-limit state.
  // Keys are opaque "{routeKey}:{HMAC-hashed-ip}" strings; we never
  // store the raw client IP. Rows expire via the retention sweep
  // (lib/payment/retention.ts) once they go stale, but stale rows
  // also self-reset on the next touch because the refill calculation
  // is monotonic in elapsed time.
  db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
      key             TEXT PRIMARY KEY,
      tokens          REAL    NOT NULL,
      last_refill_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rate_limit_last_refill
      ON rate_limit_buckets(last_refill_at);
  `);

  // v0.2.x security slice — audit log for PII-touching reads/writes.
  // Subjects are always SHA-256 hashed before persistence so the log
  // itself is not a second PII store. Retained 1 year by the sweep.
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at   INTEGER NOT NULL,
      event_type    TEXT NOT NULL,
      actor         TEXT NOT NULL,
      subject_hash  TEXT,
      outcome       TEXT NOT NULL,
      ip_hash       TEXT,
      ua_hash       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_occurred ON audit_log(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_audit_event
      ON audit_log(event_type, occurred_at);
  `);

  // v0.2.x security slice — OFAC / sanctions denylist for payer wallets.
  // Sourced from a community OFAC list (US Treasury SDN export + the
  // well-known Tornado Cash deposit addresses) on first boot via
  // lib/payment/sanctions.ts. Cached locally so the watcher's hot path
  // never hits the network. The `chain` column lets us key the same
  // address across chains (a sanctioned ETH address has a corresponding
  // representation on Solana via wrapped contracts).
  db.exec(`
    CREATE TABLE IF NOT EXISTS sanctioned_addresses (
      address     TEXT NOT NULL,
      chain       TEXT NOT NULL,
      source      TEXT NOT NULL,
      added_at    INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      removed_at  INTEGER,
      PRIMARY KEY (address, chain)
    );
    CREATE INDEX IF NOT EXISTS idx_sanctioned_address ON sanctioned_addresses(address);
  `);
}

export function getDb(): DB {
  if (!g[KEY]) g[KEY] = init();
  return g[KEY];
}

/* ------------------------------------------------------------------ *\
 * Domain types
\* ------------------------------------------------------------------ */

export interface SessionRow {
  session_id: string;
  tier: string;
  cadence: string;
  chain: string;
  token: string;
  dest_address: string;
  amount: number;
  decimals: number;
  amount_usd_cents: number;
  discount_bps: number;
  rate_locked: number;
  expires_at: number;
  status: 'pending' | 'confirmed' | 'expired' | 'failed';
  tx_sig: string | null;
  confirmed_at: number | null;
  payer_address: string | null;
  grant_code: string | null;
  memo: string | null;
  created_at: number;
}

export interface SubscriptionRow {
  id: number;
  wallet_address: string;
  tier: string;
  cadence: string;
  expires_at: number | null;
  session_id: string | null;
  created_at: number;
  /**
   * Set when a grant binding the wallet's subscription to a Telegram
   * user has been redeemed, or when the wallet was pre-linked before
   * payment. v0.2.0+ column; null on legacy rows.
   */
  telegram_user_id: number | null;
}

export interface GrantRow {
  code: string;
  session_id: string;
  created_at: number;
  expires_at: number;
  redeemed_by: number | null;
  redeemed_at: number | null;
}

export interface AuthSessionRow {
  token: string;
  wallet_address: string;
  created_at: number;
  expires_at: number;
  /**
   * Populated when the SIWS-authenticated wallet is bound to a
   * Telegram user via `wallet_links`. v0.2.0+ column; null on legacy
   * rows and for any wallet that has not been linked.
   */
  telegram_user_id: number | null;
}

export interface WalletLinkRow {
  telegram_user_id: number;
  wallet_address: string;
  linked_at: number;
  siws_token: string | null;
}

export interface IdempotencyKeyRow {
  key: string;
  session_id: string;
  created_at: number;
}

export interface RateCacheRow {
  token: string;
  usd_per: number;
  fetched_at: number;
  source: string;
}

/* ------------------------------------------------------------------ *\
 * Repository helpers — keep raw SQL behind named functions for callers.
\* ------------------------------------------------------------------ */

export function insertSession(row: Omit<SessionRow, 'created_at' | 'tx_sig' | 'confirmed_at' | 'payer_address' | 'grant_code' | 'memo'> & { memo?: string }): void {
  getDb()
    .prepare(
      `INSERT INTO payment_sessions
       (session_id, tier, cadence, chain, token, dest_address,
        amount, decimals, amount_usd_cents, discount_bps,
        rate_locked, expires_at, status, memo)
       VALUES (@session_id, @tier, @cadence, @chain, @token, @dest_address,
        @amount, @decimals, @amount_usd_cents, @discount_bps,
        @rate_locked, @expires_at, @status, @memo)`,
    )
    .run({ ...row, memo: row.memo ?? null });
}

export function getSessionRow(sessionId: string): SessionRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM payment_sessions WHERE session_id = ?`)
    .get(sessionId) as SessionRow | undefined;
  return row ?? null;
}

export function listPendingSessions(now: number): SessionRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM payment_sessions
       WHERE status = 'pending' AND expires_at > ?`,
    )
    .all(now) as SessionRow[];
}

export function expireStaleSessions(now: number): number {
  const r = getDb()
    .prepare(
      `UPDATE payment_sessions SET status='expired'
       WHERE status='pending' AND expires_at <= ?`,
    )
    .run(now);
  return r.changes;
}

export function markSessionConfirmed(
  sessionId: string,
  txSig: string,
  payerAddress: string,
  confirmedAt: number,
): void {
  getDb()
    .prepare(
      `UPDATE payment_sessions
       SET status='confirmed', tx_sig=?, payer_address=?, confirmed_at=?
       WHERE session_id=? AND status='pending'`,
    )
    .run(txSig, payerAddress, confirmedAt, sessionId);
}

export function attachGrantCodeToSession(
  sessionId: string,
  code: string,
): void {
  getDb()
    .prepare(`UPDATE payment_sessions SET grant_code=? WHERE session_id=?`)
    .run(code, sessionId);
}

export function insertGrant(row: Omit<GrantRow, 'created_at' | 'redeemed_by' | 'redeemed_at'>): void {
  getDb()
    .prepare(
      `INSERT INTO grants (code, session_id, expires_at)
       VALUES (@code, @session_id, @expires_at)`,
    )
    .run(row);
}

export function getGrant(code: string): GrantRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM grants WHERE code = ?`)
    .get(code) as GrantRow | undefined;
  return row ?? null;
}

export function redeemGrant(code: string, telegramUserId: number): void {
  getDb()
    .prepare(
      `UPDATE grants SET redeemed_by=?, redeemed_at=?
       WHERE code=? AND redeemed_by IS NULL`,
    )
    .run(telegramUserId, Date.now(), code);
}

/**
 * Insert a subscription row. The `telegram_user_id` field is optional
 * at the API level — pre-v0.2.0 callers (the Solana watcher's
 * `finalizeSession`) do not know the TG id at confirmation time. The
 * column is back-filled later by `attachTelegramIdToSubscription` when
 * the user redeems a grant, or eagerly populated when a wallet link
 * already exists at payment time (the C1 watcher seam).
 */
export function insertSubscription(
  row: Omit<SubscriptionRow, 'id' | 'created_at' | 'telegram_user_id'> & {
    telegram_user_id?: number | null;
  },
): number {
  const r = getDb()
    .prepare(
      `INSERT INTO subscriptions
         (wallet_address, tier, cadence, expires_at, session_id, telegram_user_id)
       VALUES
         (@wallet_address, @tier, @cadence, @expires_at, @session_id, @telegram_user_id)`,
    )
    .run({
      wallet_address: row.wallet_address,
      tier: row.tier,
      cadence: row.cadence,
      expires_at: row.expires_at,
      session_id: row.session_id,
      telegram_user_id: row.telegram_user_id ?? null,
    });
  return r.lastInsertRowid as number;
}

export function findActiveSubscriptionByWallet(
  wallet: string,
  now: number,
): SubscriptionRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM subscriptions
       WHERE wallet_address = ?
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY id DESC LIMIT 1`,
    )
    .get(wallet, now) as SubscriptionRow | undefined;
  return row ?? null;
}

/**
 * Insert an auth_sessions row. `telegram_user_id` is optional and
 * defaults to null; the SIWS verify route may populate it eagerly when
 * the signing wallet is already in `wallet_links`. Backward compatible
 * with v0.1.0 callers that pass only `{ token, wallet_address,
 * expires_at }`.
 */
export function insertAuthSession(
  row: Omit<AuthSessionRow, 'created_at' | 'telegram_user_id'> & {
    telegram_user_id?: number | null;
  },
): void {
  getDb()
    .prepare(
      `INSERT INTO auth_sessions (token, wallet_address, expires_at, telegram_user_id)
       VALUES (@token, @wallet_address, @expires_at, @telegram_user_id)`,
    )
    .run({
      token: row.token,
      wallet_address: row.wallet_address,
      expires_at: row.expires_at,
      telegram_user_id: row.telegram_user_id ?? null,
    });
}

export function getAuthSession(token: string): AuthSessionRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM auth_sessions WHERE token = ?`)
    .get(token) as AuthSessionRow | undefined;
  return row ?? null;
}

export function deleteAuthSession(token: string): void {
  getDb().prepare(`DELETE FROM auth_sessions WHERE token = ?`).run(token);
}

/* ------------------------------------------------------------------ *\
 * v0.2.0 — wallet_links + subscription/TG-id helpers (RFC §3, §5, §6).
\* ------------------------------------------------------------------ */

/**
 * Insert a wallet_links row. Caller is responsible for handling the
 * `UNIQUE` constraint violation on either `telegram_user_id` or
 * `wallet_address`; the lower-level routes use `INSERT OR IGNORE` for
 * idempotency, while the SIWS pre-link route uses a strict INSERT so
 * the route can return `already_linked_elsewhere`.
 *
 * `strict=false` (default) is `INSERT OR IGNORE` — no-op on conflict.
 * `strict=true` throws on conflict; the caller maps to a 409.
 */
export function insertWalletLink(
  row: Omit<WalletLinkRow, 'linked_at'> & { linked_at?: number },
  opts: { strict?: boolean } = {},
): { inserted: boolean } {
  const strict = opts.strict === true;
  const sql = strict
    ? `INSERT INTO wallet_links (telegram_user_id, wallet_address, siws_token, linked_at)
       VALUES (@telegram_user_id, @wallet_address, @siws_token, COALESCE(@linked_at, CAST(strftime('%s','now') AS INTEGER) * 1000))`
    : `INSERT OR IGNORE INTO wallet_links (telegram_user_id, wallet_address, siws_token, linked_at)
       VALUES (@telegram_user_id, @wallet_address, @siws_token, COALESCE(@linked_at, CAST(strftime('%s','now') AS INTEGER) * 1000))`;
  const r = getDb()
    .prepare(sql)
    .run({
      telegram_user_id: row.telegram_user_id,
      wallet_address: row.wallet_address,
      siws_token: row.siws_token ?? null,
      linked_at: row.linked_at ?? null,
    });
  return { inserted: r.changes > 0 };
}

export function findWalletLinkByTelegramId(
  telegramUserId: number,
): WalletLinkRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM wallet_links WHERE telegram_user_id = ?`)
    .get(telegramUserId) as WalletLinkRow | undefined;
  return row ?? null;
}

export function findWalletLinkByWallet(
  walletAddress: string,
): WalletLinkRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM wallet_links WHERE wallet_address = ?`)
    .get(walletAddress) as WalletLinkRow | undefined;
  return row ?? null;
}

/**
 * Atomically attach a Telegram user id to a subscription row identified
 * by its primary key. Only sets the column if it is currently NULL — a
 * subscription already bound to a different TG id is left untouched and
 * the caller is expected to detect the no-op via the returned `changed`
 * flag and surface `already_redeemed`.
 */
export function attachTelegramIdToSubscription(
  subscriptionId: number,
  telegramUserId: number,
): { changed: boolean } {
  const r = getDb()
    .prepare(
      `UPDATE subscriptions
       SET telegram_user_id = ?
       WHERE id = ? AND telegram_user_id IS NULL`,
    )
    .run(telegramUserId, subscriptionId);
  return { changed: r.changes > 0 };
}

export function findSubscriptionByTelegramId(
  telegramUserId: number,
  now: number,
): SubscriptionRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM subscriptions
       WHERE telegram_user_id = ?
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY id DESC LIMIT 1`,
    )
    .get(telegramUserId, now) as SubscriptionRow | undefined;
  return row ?? null;
}

/**
 * Look up the subscription row attached to a confirmed payment session.
 * Used by the grant-redeem route: the grant points at a session, the
 * session has at most one confirmed subscription row, and that row is
 * the target of `attachTelegramIdToSubscription`.
 */
export function findSubscriptionBySessionId(
  sessionId: string,
): SubscriptionRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM subscriptions
       WHERE session_id = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(sessionId) as SubscriptionRow | undefined;
  return row ?? null;
}

/* ------------------------------------------------------------------ *\
 * v0.2.0 — idempotency helpers (POST /api/payment/session dedupe).
\* ------------------------------------------------------------------ */

export function insertIdempotencyKey(
  row: Omit<IdempotencyKeyRow, 'created_at'>,
): void {
  getDb()
    .prepare(
      `INSERT INTO idempotency_keys (key, session_id) VALUES (@key, @session_id)`,
    )
    .run(row);
}

export function findIdempotencyKey(key: string): IdempotencyKeyRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM idempotency_keys WHERE key = ?`)
    .get(key) as IdempotencyKeyRow | undefined;
  return row ?? null;
}

/**
 * Purge idempotency rows older than `cutoff` millis. Returns the
 * number of rows removed. Called from the watcher-tick sweeper.
 */
export function pruneIdempotencyKeys(cutoff: number): number {
  const r = getDb()
    .prepare(`DELETE FROM idempotency_keys WHERE created_at < ?`)
    .run(cutoff);
  return r.changes;
}

/* ------------------------------------------------------------------ *\
 * v0.2.0 — persisted last-known-good rate cache.
\* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *\
 * v0.2.x — OFAC / sanctions denylist helpers.
 *
 * The hot path (`isSanctionedAddress`) is a single primary-key lookup
 * on `(address, chain)` and runs every time the watcher matches a
 * payer to a session. The seed list is loaded once at startup via
 * lib/payment/sanctions.ts; subsequent additions go through
 * `insertSanctionedAddress` (operator-driven, no auto-fetch in v1).
\* ------------------------------------------------------------------ */

export interface SanctionedAddressRow {
  address: string;
  chain: string;
  source: string;
  added_at: number;
  removed_at: number | null;
}

export function insertSanctionedAddress(
  row: Omit<SanctionedAddressRow, 'added_at' | 'removed_at'> & {
    added_at?: number;
  },
): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO sanctioned_addresses (address, chain, source, added_at)
       VALUES (@address, @chain, @source, @added_at)`,
    )
    .run({
      address: row.address,
      chain: row.chain,
      source: row.source,
      added_at: row.added_at ?? Date.now(),
    });
}

export function isSanctionedAddress(address: string, chain?: string): boolean {
  const db = getDb();
  if (chain) {
    const row = db
      .prepare(
        `SELECT 1 FROM sanctioned_addresses
         WHERE address = ? AND chain = ? AND removed_at IS NULL`,
      )
      .get(address, chain) as { 1: number } | undefined;
    return row !== undefined;
  }
  // Chain-agnostic lookup — defends a Solana payment from a sanctioned
  // EVM address that funded the bridge if the same string happens to be
  // a valid Solana address. Cheap insurance.
  const row = db
    .prepare(
      `SELECT 1 FROM sanctioned_addresses WHERE address = ? AND removed_at IS NULL LIMIT 1`,
    )
    .get(address) as { 1: number } | undefined;
  return row !== undefined;
}

export function countSanctionedAddresses(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM sanctioned_addresses WHERE removed_at IS NULL`)
    .get() as { n: number };
  return row.n;
}

export function upsertRateCache(row: RateCacheRow): void {
  getDb()
    .prepare(
      `INSERT INTO rate_cache (token, usd_per, fetched_at, source)
       VALUES (@token, @usd_per, @fetched_at, @source)
       ON CONFLICT(token) DO UPDATE SET
         usd_per    = excluded.usd_per,
         fetched_at = excluded.fetched_at,
         source     = excluded.source`,
    )
    .run(row);
}

export function getRateCache(token: string): RateCacheRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM rate_cache WHERE token = ?`)
    .get(token) as RateCacheRow | undefined;
  return row ?? null;
}
