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
  runV04TreasuryMigrations(db);
  runV041DirectoryMigrations(db);
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
  // v0.4 — scheduled plan transition. Null = no schedule; the row
  // naturally lapses to free at expires_at. 'cancel' = let the period
  // run out then drop to free (no renewal nudge). 'downgrade_to_pro'
  // = same lifecycle, but the next paid plan we surface is Pro
  // rather than the current Elite. Read-only by the tier resolver
  // (purely a UX surface); written by the cancel + downgrade routes.
  addColumnIfMissing(db, 'subscriptions', 'scheduled_action', 'TEXT');
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

  /* v0.3.0 — wallet-bound free-tier counter.
   *
   * Replaces the legacy cookie-based gate (`vizzor.free_used`) for
   * /predict. Free-tier predictions are now counted per SIWS-bound
   * wallet so a single user cannot multiply their quota by clearing
   * cookies / using incognito. Subscribers still bypass entirely; this
   * row is only consulted on the free path.
   *
   * Additive — fresh DBs and existing DBs behave identically when no
   * row is present (counts as zero). */
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_free_usage (
      wallet_address  TEXT PRIMARY KEY,
      used            INTEGER NOT NULL DEFAULT 0,
      first_used_at   INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      last_used_at    INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    );
  `);

  /* v0.3.0 — server-persisted chat conversations.
   *
   * Each row is one chat thread owned by a SIWS-authenticated wallet.
   * Title is derived from the first user message (truncated). The
   * messages live in a child table joined by `conversation_id`.
   * Ordering for the sidebar list is `updated_at DESC` so the chat
   * the user touched most recently floats to the top.
   *
   * Cascade delete: dropping a conversation drops all its messages
   * (foreign_keys pragma is ON above). */
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id              TEXT PRIMARY KEY,
      wallet_address  TEXT NOT NULL,
      title           TEXT NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      updated_at      INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_wallet_updated
      ON conversations(wallet_address, updated_at DESC);

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role            TEXT NOT NULL,
      content         TEXT NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
      ON conversation_messages(conversation_id, created_at);
  `);

  /* v0.3.2 — 7-day Pro trial + per-day cap + telemetry on the free tier.
   *
   * The legacy "7 runs per wallet forever" gate is replaced by a
   * time-based trial: each wallet gets full Pro-equivalent access for
   * `freeTrialDays()` (default 7) days from `trial_started_at`. A
   * `daily_used` counter (anchored on `daily_used_at`) caps abuse —
   * default 5 predictions/day for trial wallets, higher for paid
   * tiers. After expiry the wallet drops to a `free` tier with no LLM
   * access. See `lib/payment/tier-resolver.ts`.
   *
   * The schema change is purely additive (`ALTER TABLE … ADD COLUMN`)
   * so a redeploy is safe; existing rows get `trial_started_at`
   * back-filled from `first_used_at` so users who started under the
   * count-based regime keep their honest anchor instead of a fresh
   * window. */
  addColumnIfMissing(db, 'wallet_free_usage', 'trial_started_at', 'INTEGER');
  addColumnIfMissing(db, 'wallet_free_usage', 'daily_used', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'wallet_free_usage', 'daily_used_at', 'INTEGER');
  db.exec(
    `UPDATE wallet_free_usage
        SET trial_started_at = COALESCE(first_used_at, CAST(strftime('%s','now') AS INTEGER) * 1000)
      WHERE trial_started_at IS NULL`,
  );

  /* v0.3.2 — per-request predict telemetry.
   *
   * One row per `/api/predict` call, regardless of outcome. Feeds a
   * future Grafana panel + cost alerts; **never** consulted by any
   * gate (so a write failure can't lock users out). Retention is
   * trimmed by `lib/payment/retention.ts` to 30 days. */
  db.exec(`
    CREATE TABLE IF NOT EXISTS predict_telemetry (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ts            INTEGER NOT NULL,
      wallet_hash   TEXT NOT NULL,
      tier          TEXT NOT NULL,
      prompt_bytes  INTEGER NOT NULL,
      status        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_predict_telemetry_ts
      ON predict_telemetry(ts);
    CREATE INDEX IF NOT EXISTS idx_predict_telemetry_wallet
      ON predict_telemetry(wallet_hash, ts);
  `);

  /* v0.3.1 — mobile Connect-Protocol handoff state.
   *
   * The Phantom/Solflare deeplink flow needs the dapp's per-attempt
   * X25519 secret key to decrypt the wallet's encrypted response when
   * the user returns. We used to stash this in localStorage, but iOS
   * Brave / Safari frequently land the wallet's universal-link redirect
   * in a new WKWebView process pool that doesn't carry the source
   * tab's per-origin storage — the secret is gone, and the callback
   * surfaces `VZ-WAL-011 mobile-handoff-missing`.
   *
   * Persisting the state server-side, keyed by a 32-byte random `id`
   * we embed in the redirect URL, makes the round trip independent of
   * any browser storage edge case. The row is one-shot (deleted on
   * first read) and TTL-bounded so abandoned attempts can't be
   * replayed. The keypair itself is X25519 (32B secret, 32B public),
   * generated freshly per attempt — trusting our own server with it
   * for ≤5 minutes is the same trust we already extend to the auth
   * session cookie. */
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_handoffs (
      id          TEXT PRIMARY KEY,
      state       TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mobile_handoffs_expires
      ON mobile_handoffs(expires_at);
  `);
}

/* ------------------------------------------------------------------ *\
 * v0.4 treasury migrations — watch-only HD model. Additive only.
 *
 * Adds per-session derived-address bookkeeping so two distinct sessions
 * never share a receive address (privacy + replay safety). The site
 * stops paying every customer's payment into a single static treasury;
 * each session is allocated a unique address from either the TON xpub
 * (via `derivation_index` → `lib/payment/hd-ton.ts`) or the Solana
 * pre-derived pool (via `pool_index` → `lib/payment/sol-pool.ts`).
 *
 * `sol_pool_state` holds a single-row counter for the next-unclaimed
 * Solana pool index. The atomic UPDATE-then-INSERT inside one
 * SQLite transaction in `claimNextAddress` is what guarantees
 * two concurrent session-creates never grab the same address.
\* ------------------------------------------------------------------ */
function runV04TreasuryMigrations(db: DB): void {
  // Per-session derived-address index. Same column name across chains
  // since the underlying model is identical (operator-pre-derived
  // pool consumed atomically). Null on legacy pre-v0.4 rows that
  // settled against the static treasury.
  addColumnIfMissing(db, 'payment_sessions', 'pool_index', 'INTEGER');
  // One state row per chain. The `chain` PK makes the
  // increment-and-claim a single atomic UPDATE...RETURNING per chain,
  // so concurrent claims on Solana don't block TON claims and vice
  // versa. `next_index` is the next-unclaimed pool entry; bump it
  // after every successful allocation.
  db.exec(`
    CREATE TABLE IF NOT EXISTS pool_state (
      chain           TEXT PRIMARY KEY,
      next_index      INTEGER NOT NULL DEFAULT 0,
      updated_at      INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    );
    INSERT OR IGNORE INTO pool_state (chain, next_index) VALUES ('solana', 0);
    INSERT OR IGNORE INTO pool_state (chain, next_index) VALUES ('ton', 0);
  `);
}

/* ------------------------------------------------------------------ *\
 * v0.4.1 directory migrations — connector store + per-wallet skill
 * activation. Additive only; a fresh DB and an upgraded DB behave the
 * same when no rows exist.
 *
 * `user_connections` is the install ledger — one row per (wallet,
 * connector) pair. Credentials are AES-256-GCM blobs (see
 * lib/security/connector-crypto.ts); the encryption key never lives in
 * the DB. Soft-revoke via `status='revoked'` so audit + analytics
 * keep the install history.
 *
 * `wallet_preferences` is a kv-by-wallet table whose first column is
 * `active_skill_id`. New preferences land here without further migration.
\* ------------------------------------------------------------------ */
function runV041DirectoryMigrations(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_connections (
      id                      TEXT PRIMARY KEY,
      wallet_address          TEXT NOT NULL,
      connector_id            TEXT NOT NULL,
      status                  TEXT NOT NULL DEFAULT 'active',
      credentials_ciphertext  BLOB,
      credentials_iv          BLOB,
      credentials_tag         BLOB,
      scopes                  TEXT NOT NULL DEFAULT '[]',
      installed_at            INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      last_used_at            INTEGER,
      revoked_at              INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_user_connections_wallet
      ON user_connections(wallet_address);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_user_connections_wallet_connector_active
      ON user_connections(wallet_address, connector_id)
      WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS wallet_preferences (
      wallet_address    TEXT PRIMARY KEY,
      active_skill_id   TEXT,
      pinned_skill_ids  TEXT NOT NULL DEFAULT '[]',
      updated_at        INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    );

    /* v0.4.1 — per-message feedback (👍 / 👎) so the engine can learn
     * which predictions land. message_id is unique per assistant turn;
     * the row gets upserted on toggle and DELETEd when the user clears
     * their vote. wallet_address + created_at index serves the per-
     * wallet rate-limit lookup. */
    CREATE TABLE IF NOT EXISTS message_feedback (
      message_id      TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      wallet_address  TEXT NOT NULL,
      value           TEXT NOT NULL CHECK(value IN ('up','down')),
      created_at      INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      updated_at      INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_message_feedback_wallet
      ON message_feedback(wallet_address, created_at);

    /* v0.4.1 — MCP personal access tokens.
     *
     * Per-wallet bearer tokens for external AI agents (Claude Desktop,
     * Cursor, ChatGPT custom GPTs). Never store the raw token — the
     * mint route returns it once and persists only sha256(token) here,
     * matching the auth-session token-hash hardening from v0.2.x.
     * Revocation is soft (status='revoked' + revoked_at) so the audit
     * trail survives.
     *
     * scopes is a JSON-array string the engine consumes to bound the
     * agent's reach (e.g. predict.read, whales.read). The engine
     * v1 MCP endpoints aren't live in v0.4.1 yet — the token surface
     * is what we ship now so the day MCP becomes urgent the table
     * already exists with real data. */
    CREATE TABLE IF NOT EXISTS mcp_personal_tokens (
      token_hash      TEXT PRIMARY KEY,
      wallet_address  TEXT NOT NULL,
      label           TEXT,
      scopes          TEXT NOT NULL DEFAULT '["predict.read"]',
      status          TEXT NOT NULL DEFAULT 'active',
      created_at      INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      last_used_at    INTEGER,
      expires_at      INTEGER,
      revoked_at      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_tokens_wallet
      ON mcp_personal_tokens(wallet_address);
  `);

  // Defensive back-fill for DBs that pre-date v0.4.1 pin storage. Older
  // wallet_preferences rows don't have the column; ADD it idempotently
  // and seed any NULL values with an empty JSON array.
  addColumnIfMissing(
    db,
    'wallet_preferences',
    'pinned_skill_ids',
    "TEXT NOT NULL DEFAULT '[]'",
  );
  db.exec(
    `UPDATE wallet_preferences SET pinned_skill_ids = '[]' WHERE pinned_skill_ids IS NULL`,
  );
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
  /** v0.4 — operator-pre-derived address-pool index for the
   *  per-session receive address. Same column for both SOL and TON;
   *  the chain disambiguates which pool to look up against. Null on
   *  pre-v0.4 legacy rows that settled against the static treasury. */
  pool_index: number | null;
}

export type ScheduledSubscriptionAction = 'cancel' | 'downgrade_to_pro';

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
  /**
   * v0.4 — pre-scheduled plan transition. The tier resolver does NOT
   * consult this; it's purely a UX surface so /account can show
   * "plan continues until {date}, then drops to {target}". The
   * underlying lifecycle is unchanged — the subscription lapses to
   * free at `expires_at` regardless. Null on legacy rows.
   */
  scheduled_action: ScheduledSubscriptionAction | null;
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

export interface WalletFreeUsageRow {
  wallet_address: string;
  used: number;
  first_used_at: number;
  last_used_at: number;
  /** Epoch ms when the 7-day Pro trial opened for this wallet. */
  trial_started_at: number | null;
  /** Epoch ms anchor for the per-day cap counter. */
  daily_used_at: number | null;
  /** Predictions used since `daily_used_at`. Resets per UTC day. */
  daily_used: number;
}

/**
 * Returns the current free-tier usage count for a wallet. Lifetime
 * counter, kept for telemetry only after the v0.3.2 shift to trial-
 * based gating. A missing row is treated as zero.
 */
export function getWalletFreeUsage(wallet: string): number {
  const row = getDb()
    .prepare(`SELECT used FROM wallet_free_usage WHERE wallet_address = ?`)
    .get(wallet) as { used: number } | undefined;
  return row?.used ?? 0;
}

/**
 * Atomically increments a wallet's lifetime predictions counter +
 * bumps the per-day cap counter (resetting to 1 if it's a new UTC
 * day). Returns the post-increment row for callers that need both
 * numbers without a second read. Idempotent at the SQL boundary via
 * UPSERT.
 *
 * The daily reset uses UTC day boundaries — every call computes the
 * start-of-current-day in UTC and compares to the stored
 * `daily_used_at`. Wallets in non-UTC timezones see their counter
 * reset at local-equivalent-of-00:00-UTC; the UI surfaces "{used}/{cap}
 * today" so the absolute boundary is implicit.
 */
export function incrementWalletFreeUsage(wallet: string): WalletFreeUsageRow {
  const now = Date.now();
  const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
  getDb()
    .prepare(
      `INSERT INTO wallet_free_usage
         (wallet_address, used, first_used_at, last_used_at,
          trial_started_at, daily_used, daily_used_at)
       VALUES (@wallet, 1, @now, @now, @now, 1, @dayStart)
       ON CONFLICT(wallet_address) DO UPDATE SET
         used         = used + 1,
         last_used_at = @now,
         daily_used   = CASE
                          WHEN COALESCE(daily_used_at, 0) >= @dayStart
                          THEN daily_used + 1
                          ELSE 1
                        END,
         daily_used_at = @dayStart`,
    )
    .run({ wallet, now, dayStart });
  return getWalletFreeUsageRow(wallet)!;
}

/**
 * Idempotently stamp the trial start anchor for a wallet. Called on
 * every authenticated `/api/predict` request so wallets that connect
 * but never predict still get a fair window if they come back later.
 * Returns the row's effective `trial_started_at`.
 */
export function startTrialIfNew(wallet: string): number {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO wallet_free_usage
         (wallet_address, used, first_used_at, last_used_at, trial_started_at)
       VALUES (@wallet, 0, @now, @now, @now)
       ON CONFLICT(wallet_address) DO UPDATE SET
         trial_started_at = COALESCE(trial_started_at, @now)`,
    )
    .run({ wallet, now });
  const row = getWalletFreeUsageRow(wallet);
  return row?.trial_started_at ?? now;
}

/**
 * Full row read — used by the tier resolver to compute trial state
 * and daily-cap headroom in one query.
 */
export function getWalletFreeUsageRow(wallet: string): WalletFreeUsageRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM wallet_free_usage WHERE wallet_address = ?`)
    .get(wallet) as WalletFreeUsageRow | undefined;
  return row ?? null;
}

/**
 * Best-effort write to `predict_telemetry`. Swallows errors so a
 * write failure can never block a request. One row per /predict call;
 * `prompt_bytes` and `status` (HTTP status code) carry the cost +
 * outcome signals a future analyzer correlates against subscription
 * conversion.
 */
export function insertPredictTelemetry(row: {
  walletHash: string;
  tier: string;
  promptBytes: number;
  status: number;
}): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO predict_telemetry (ts, wallet_hash, tier, prompt_bytes, status)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(Date.now(), row.walletHash, row.tier, row.promptBytes, row.status);
  } catch {
    // Telemetry must never break the request path.
  }
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

export function insertSession(
  row: Omit<
    SessionRow,
    | 'created_at'
    | 'tx_sig'
    | 'confirmed_at'
    | 'payer_address'
    | 'grant_code'
    | 'memo'
    | 'pool_index'
  > & {
    memo?: string;
    pool_index?: number | null;
  },
): void {
  getDb()
    .prepare(
      `INSERT INTO payment_sessions
       (session_id, tier, cadence, chain, token, dest_address,
        amount, decimals, amount_usd_cents, discount_bps,
        rate_locked, expires_at, status, memo,
        pool_index)
       VALUES (@session_id, @tier, @cadence, @chain, @token, @dest_address,
        @amount, @decimals, @amount_usd_cents, @discount_bps,
        @rate_locked, @expires_at, @status, @memo,
        @pool_index)`,
    )
    .run({
      ...row,
      memo: row.memo ?? null,
      pool_index: row.pool_index ?? null,
    });
}

export type PoolChain = 'solana' | 'ton';

/**
 * Atomically claim the next pool index for the given chain. Uses
 * UPDATE...RETURNING so the read + write are one SQL statement —
 * concurrent claims serialize through SQLite's write lock and never
 * observe the same index twice. Per-chain rows mean a SOL claim
 * never blocks a TON claim (or vice versa).
 */
export function claimNextPoolIndex(chain: PoolChain): number {
  const row = getDb()
    .prepare(
      `UPDATE pool_state
       SET next_index = next_index + 1,
           updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
       WHERE chain = ?
       RETURNING next_index - 1 AS claimed`,
    )
    .get(chain) as { claimed: number } | undefined;
  if (!row) {
    throw new Error(
      `pool_state row missing for chain=${chain} — migration did not run`,
    );
  }
  return row.claimed;
}

export function getPoolNextIndex(chain: PoolChain): number {
  const row = getDb()
    .prepare(`SELECT next_index FROM pool_state WHERE chain = ?`)
    .get(chain) as { next_index: number } | undefined;
  return row?.next_index ?? 0;
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
  // New subscriptions are always inserted with a clear ledger —
  // `scheduled_action` only gets set later via the cancel/downgrade
  // routes, so the caller doesn't need to thread null through.
  row: Omit<
    SubscriptionRow,
    'id' | 'created_at' | 'telegram_user_id' | 'scheduled_action'
  > & {
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
 * Stamp a scheduled plan transition on the wallet's currently-active
 * subscription. The tier resolver doesn't consult this field; it's a
 * UX-only marker so /account can show "plan continues until {date},
 * then drops to {target}" and the subscribe CTA on /pricing can hint
 * at the upcoming change.
 *
 * Returns the updated row, or `null` if the wallet has no active
 * subscription (in which case there's nothing to schedule).
 *
 * Idempotent: passing the same `action` twice is a no-op DB-write
 * but still returns the row. Passing `null` clears any prior
 * schedule so the user can change their mind.
 */
export function setScheduledActionForActiveSubscription(
  wallet: string,
  action: ScheduledSubscriptionAction | null,
  now: number,
): SubscriptionRow | null {
  const row = findActiveSubscriptionByWallet(wallet, now);
  if (!row) return null;
  getDb()
    .prepare(`UPDATE subscriptions SET scheduled_action = ? WHERE id = ?`)
    .run(action, row.id);
  return { ...row, scheduled_action: action };
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

/* ------------------------------------------------------------------ *\
 * Conversations — server-persisted /predict chat threads.
\* ------------------------------------------------------------------ */

export interface ConversationRow {
  id: string;
  wallet_address: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface ConversationMessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

const TITLE_FALLBACK = 'New chat';
const TITLE_MAX_CHARS = 80;

export function deriveConversationTitle(firstUserMessage: string): string {
  const trimmed = firstUserMessage.trim().replace(/\s+/g, ' ');
  if (!trimmed) return TITLE_FALLBACK;
  if (trimmed.length <= TITLE_MAX_CHARS) return trimmed;
  return trimmed.slice(0, TITLE_MAX_CHARS - 1).trimEnd() + '…';
}

export function createConversation(opts: {
  id: string;
  wallet: string;
  title?: string;
}): ConversationRow {
  const now = Date.now();
  const row: ConversationRow = {
    id: opts.id,
    wallet_address: opts.wallet,
    title: opts.title?.trim() || TITLE_FALLBACK,
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(
      `INSERT INTO conversations (id, wallet_address, title, created_at, updated_at)
       VALUES (@id, @wallet_address, @title, @created_at, @updated_at)`,
    )
    .run(row);
  return row;
}

export function listConversationsForWallet(
  wallet: string,
  limit = 50,
): ConversationRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM conversations
        WHERE wallet_address = ?
        ORDER BY updated_at DESC
        LIMIT ?`,
    )
    .all(wallet, limit) as ConversationRow[];
}

export function getConversationForWallet(
  id: string,
  wallet: string,
): ConversationRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM conversations WHERE id = ? AND wallet_address = ?`,
    )
    .get(id, wallet) as ConversationRow | undefined;
  return row ?? null;
}

export function listMessagesForConversation(
  conversationId: string,
): ConversationMessageRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM conversation_messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC, id ASC`,
    )
    .all(conversationId) as ConversationMessageRow[];
}

export function appendConversationMessage(opts: {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
}): void {
  const now = Date.now();
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO conversation_messages (id, conversation_id, role, content, created_at)
       VALUES (@id, @conversation_id, @role, @content, @created_at)`,
    ).run({
      id: opts.id,
      conversation_id: opts.conversationId,
      role: opts.role,
      content: opts.content,
      created_at: now,
    });
    db.prepare(
      `UPDATE conversations SET updated_at = ? WHERE id = ?`,
    ).run(now, opts.conversationId);
  });
  tx();
}

export function updateConversationTitle(
  conversationId: string,
  wallet: string,
  title: string,
): void {
  const clean = title.trim() || TITLE_FALLBACK;
  getDb()
    .prepare(
      `UPDATE conversations SET title = ?, updated_at = ?
        WHERE id = ? AND wallet_address = ?`,
    )
    .run(clean, Date.now(), conversationId, wallet);
}

export function deleteConversationForWallet(
  id: string,
  wallet: string,
): boolean {
  const r = getDb()
    .prepare(`DELETE FROM conversations WHERE id = ? AND wallet_address = ?`)
    .run(id, wallet);
  return r.changes > 0;
}

/* ------------------------------------------------------------------ *\
 * Mobile Connect-Protocol handoff persistence
\* ------------------------------------------------------------------ */

export interface MobileHandoffRow {
  id: string;
  state: string;
  created_at: number;
  expires_at: number;
}

/**
 * Persist a new handoff state. `state` is opaque JSON the caller
 * controls — we treat it as a blob. Caller passes the generated `id`
 * (32-byte hex, ~unguessable) and TTL window.
 */
export function insertMobileHandoff(opts: {
  id: string;
  state: string;
  expiresAt: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO mobile_handoffs (id, state, created_at, expires_at)
        VALUES (?, ?, ?, ?)`,
    )
    .run(opts.id, opts.state, Date.now(), opts.expiresAt);
}

/**
 * One-shot redeem: returns the row if it exists AND hasn't expired,
 * AND removes it atomically so a second call can't replay. Returns
 * `null` on missing / expired / already-redeemed.
 *
 * Atomic via a transaction: SELECT then DELETE inside the same
 * better-sqlite3 transaction so a concurrent redeem can't get the
 * same row twice.
 */
export function redeemMobileHandoff(id: string): MobileHandoffRow | null {
  const db = getDb();
  const tx = db.transaction((handoffId: string) => {
    const row = db
      .prepare(
        `SELECT id, state, created_at, expires_at
           FROM mobile_handoffs WHERE id = ?`,
      )
      .get(handoffId) as MobileHandoffRow | undefined;
    if (!row) return null;
    db.prepare(`DELETE FROM mobile_handoffs WHERE id = ?`).run(handoffId);
    if (row.expires_at < Date.now()) return null;
    return row;
  });
  return tx(id);
}

/**
 * Hourly maintenance helper — removes every handoff whose TTL has
 * already passed. Wired into the retention-sweep cron. */
export function pruneExpiredMobileHandoffs(): number {
  const r = getDb()
    .prepare(`DELETE FROM mobile_handoffs WHERE expires_at < ?`)
    .run(Date.now());
  return r.changes;
}

/* ------------------------------------------------------------------ *\
 * v0.4.1 — directory (connector / skill) helpers.
\* ------------------------------------------------------------------ */

export type ConnectorStatus = 'active' | 'paused' | 'revoked';

export interface UserConnectionRow {
  id: string;
  wallet_address: string;
  connector_id: string;
  status: ConnectorStatus;
  credentials_ciphertext: Buffer | null;
  credentials_iv: Buffer | null;
  credentials_tag: Buffer | null;
  scopes: string;
  installed_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

export function insertUserConnection(row: {
  id: string;
  wallet: string;
  connectorId: string;
  scopes: string[];
  ciphertext: Buffer | null;
  iv: Buffer | null;
  tag: Buffer | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO user_connections
         (id, wallet_address, connector_id, status,
          credentials_ciphertext, credentials_iv, credentials_tag, scopes)
       VALUES (@id, @wallet, @connectorId, 'active',
          @ciphertext, @iv, @tag, @scopes)`,
    )
    .run({
      id: row.id,
      wallet: row.wallet,
      connectorId: row.connectorId,
      ciphertext: row.ciphertext,
      iv: row.iv,
      tag: row.tag,
      scopes: JSON.stringify(row.scopes),
    });
}

export function listActiveConnectionsForWallet(
  wallet: string,
): UserConnectionRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM user_connections
         WHERE wallet_address = ? AND status = 'active'
         ORDER BY installed_at DESC`,
    )
    .all(wallet) as UserConnectionRow[];
}

export function getUserConnection(
  id: string,
  wallet: string,
): UserConnectionRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM user_connections WHERE id = ? AND wallet_address = ?`,
    )
    .get(id, wallet) as UserConnectionRow | undefined;
  return row ?? null;
}

export function revokeUserConnection(id: string, wallet: string): boolean {
  const r = getDb()
    .prepare(
      `UPDATE user_connections
         SET status = 'revoked', revoked_at = ?
         WHERE id = ? AND wallet_address = ? AND status = 'active'`,
    )
    .run(Date.now(), id, wallet);
  return r.changes > 0;
}

export function rotateUserConnectionCredentials(
  id: string,
  wallet: string,
  ciphertext: Buffer,
  iv: Buffer,
  tag: Buffer,
): boolean {
  const r = getDb()
    .prepare(
      `UPDATE user_connections
         SET credentials_ciphertext = ?, credentials_iv = ?, credentials_tag = ?
         WHERE id = ? AND wallet_address = ? AND status = 'active'`,
    )
    .run(ciphertext, iv, tag, id, wallet);
  return r.changes > 0;
}

export function markConnectionUsed(id: string): void {
  getDb()
    .prepare(`UPDATE user_connections SET last_used_at = ? WHERE id = ?`)
    .run(Date.now(), id);
}

/**
 * Per-wallet preferences. Only `active_skill_id` lives here today, but
 * the table is intentionally a kv-row so future preferences (timezone,
 * default surface, etc.) extend by ALTER instead of new tables.
 */
export interface WalletPreferencesRow {
  wallet_address: string;
  active_skill_id: string | null;
  pinned_skill_ids: string;
  updated_at: number;
}

export function getWalletPreferences(
  wallet: string,
): WalletPreferencesRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM wallet_preferences WHERE wallet_address = ?`)
    .get(wallet) as WalletPreferencesRow | undefined;
  return row ?? null;
}

/**
 * Upsert the wallet's active skill id. Pass `null` to clear the
 * selection (engine falls back to default behavior). Caller is
 * responsible for validating that `skillId` exists in the catalog —
 * the table stores any string for migration flexibility.
 */
export function setActiveSkillForWallet(
  wallet: string,
  skillId: string | null,
): void {
  getDb()
    .prepare(
      `INSERT INTO wallet_preferences (wallet_address, active_skill_id, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(wallet_address) DO UPDATE SET
         active_skill_id = excluded.active_skill_id,
         updated_at      = excluded.updated_at`,
    )
    .run(wallet, skillId, Date.now());
}

/**
 * Pinned catalog items (skills + connectors) populate the composer "+"
 * picker — the picker shows ONLY pinned items, the full catalog lives
 * on /app/directory. Stored as a JSON-encoded TEXT array on the
 * pinned_skill_ids column (name kept for migration compatibility; the
 * column now holds any catalog entry id, not just skill ids). The
 * engine never reads this — pure UI affordance.
 */
export function setPinnedItemForWallet(
  wallet: string,
  itemId: string,
  pinned: boolean,
): void {
  const db = getDb();
  const row = db
    .prepare(`SELECT pinned_skill_ids FROM wallet_preferences WHERE wallet_address = ?`)
    .get(wallet) as { pinned_skill_ids: string | null } | undefined;
  const current = parsePinned(row?.pinned_skill_ids ?? null);
  const set = new Set(current);
  if (pinned) set.add(itemId);
  else set.delete(itemId);
  const next = JSON.stringify([...set]);
  db.prepare(
    `INSERT INTO wallet_preferences (wallet_address, pinned_skill_ids, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(wallet_address) DO UPDATE SET
       pinned_skill_ids = excluded.pinned_skill_ids,
       updated_at       = excluded.updated_at`,
  ).run(wallet, next, Date.now());
}

function parsePinned(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ *\
 * v0.4.1 — per-message feedback (👍 / 👎).
 *
 * Captures binary signal on each assistant turn so the engine can
 * adjust calibration over time. value === null deletes the row so the
 * UI can render an "unset" thumb cleanly.
\* ------------------------------------------------------------------ */

export type MessageFeedbackValue = 'up' | 'down';

export interface MessageFeedbackRow {
  message_id: string;
  conversation_id: string;
  wallet_address: string;
  value: MessageFeedbackValue;
  created_at: number;
  updated_at: number;
}

export function setMessageFeedback(opts: {
  messageId: string;
  conversationId: string;
  wallet: string;
  value: MessageFeedbackValue | null;
}): void {
  const db = getDb();
  if (opts.value === null) {
    db.prepare(
      `DELETE FROM message_feedback
        WHERE message_id = ? AND wallet_address = ?`,
    ).run(opts.messageId, opts.wallet);
    return;
  }
  const now = Date.now();
  db.prepare(
    `INSERT INTO message_feedback
       (message_id, conversation_id, wallet_address, value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(message_id) DO UPDATE SET
       value      = excluded.value,
       updated_at = excluded.updated_at`,
  ).run(opts.messageId, opts.conversationId, opts.wallet, opts.value, now, now);
}

export function getMessageFeedback(
  messageId: string,
  wallet: string,
): MessageFeedbackRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM message_feedback
        WHERE message_id = ? AND wallet_address = ?`,
    )
    .get(messageId, wallet) as MessageFeedbackRow | undefined;
  return row ?? null;
}

/* ------------------------------------------------------------------ *\
 * v0.4.1 — MCP personal token helpers.
\* ------------------------------------------------------------------ */

export interface McpTokenRow {
  token_hash: string;
  wallet_address: string;
  label: string | null;
  scopes: string;
  status: 'active' | 'revoked';
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
}

export function insertMcpToken(row: {
  tokenHash: string;
  wallet: string;
  label: string | null;
  scopes: string[];
  expiresAt: number | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO mcp_personal_tokens
         (token_hash, wallet_address, label, scopes, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      row.tokenHash,
      row.wallet,
      row.label,
      JSON.stringify(row.scopes),
      row.expiresAt,
    );
}

export function listMcpTokensForWallet(wallet: string): McpTokenRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM mcp_personal_tokens
         WHERE wallet_address = ? AND status = 'active'
         ORDER BY created_at DESC`,
    )
    .all(wallet) as McpTokenRow[];
}

export function revokeMcpToken(tokenHash: string, wallet: string): boolean {
  const r = getDb()
    .prepare(
      `UPDATE mcp_personal_tokens
         SET status = 'revoked', revoked_at = ?
         WHERE token_hash = ? AND wallet_address = ? AND status = 'active'`,
    )
    .run(Date.now(), tokenHash, wallet);
  return r.changes > 0;
}
