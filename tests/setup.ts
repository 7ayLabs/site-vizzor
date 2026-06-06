/**
 * Global test setup.
 *
 * Wires a temporary SQLite database under /tmp keyed by the test
 * process PID so parallel forks never collide. The DB is reset
 * between every test via beforeEach so unit tests start from a
 * known-empty schema and never observe one another's writes.
 *
 * Why a per-pid path rather than :memory:?
 *   - lib/payment/db.ts stashes the connection on globalThis with
 *     a Symbol.for key, which would persist across files unless
 *     we explicitly drop it. A file-backed path lets us close +
 *     unlink + re-init deterministically.
 *   - better-sqlite3 ':memory:' databases are per-connection. If a
 *     helper opened a second connection it would not share rows
 *     with the singleton — file-backed avoids that footgun.
 */

import { afterAll, beforeEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const TEST_DB_PATH = `/tmp/vizzor-test-${process.pid}.db`;

process.env.NODE_ENV = 'test';
process.env.VIZZOR_SITE_DB = TEST_DB_PATH;
// Feature flags must be on for createSession/watcher paths under test.
process.env.NEXT_PUBLIC_ACCEPT_VIZZOR_PAYMENTS = 'true';
process.env.NEXT_PUBLIC_ACCEPT_TON_PAYMENTS = 'true';
// Mock $VIZZOR rate so rates.ts returns a stable value without network.
process.env.NEXT_PUBLIC_VIZZOR_MOCK_USD = '0.10';

mkdirSync(dirname(TEST_DB_PATH), { recursive: true });

// Reset the DB between every test. We drop the file and clear the
// singleton stashed on globalThis so the next getDb() call re-inits.
const DB_GLOBAL_KEY = Symbol.for('vizzor.site.db');

function resetDb(): void {
  // Clear the cached connection so the next import re-initializes.
  // We type the globalThis surface narrowly to avoid `any`.
  const g = globalThis as unknown as { [k: symbol]: unknown };
  const existing = g[DB_GLOBAL_KEY] as { close?: () => void } | undefined;
  if (existing && typeof existing.close === 'function') {
    try {
      existing.close();
    } catch {
      // best-effort
    }
  }
  delete g[DB_GLOBAL_KEY];

  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH, { force: true });
  if (existsSync(`${TEST_DB_PATH}-wal`)) {
    rmSync(`${TEST_DB_PATH}-wal`, { force: true });
  }
  if (existsSync(`${TEST_DB_PATH}-shm`)) {
    rmSync(`${TEST_DB_PATH}-shm`, { force: true });
  }
}

beforeEach(() => {
  resetDb();
});

afterAll(() => {
  resetDb();
});

// Re-export to surface the helper for any test that wants to force a
// reset mid-test (rare, but handy for the watcher idempotency tests).
export { resetDb };
export { Database };
