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
  `);
  return db;
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

export function insertSubscription(row: Omit<SubscriptionRow, 'id' | 'created_at'>): number {
  const r = getDb()
    .prepare(
      `INSERT INTO subscriptions (wallet_address, tier, cadence, expires_at, session_id)
       VALUES (@wallet_address, @tier, @cadence, @expires_at, @session_id)`,
    )
    .run(row);
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

export function insertAuthSession(row: Omit<AuthSessionRow, 'created_at'>): void {
  getDb()
    .prepare(
      `INSERT INTO auth_sessions (token, wallet_address, expires_at)
       VALUES (@token, @wallet_address, @expires_at)`,
    )
    .run(row);
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
