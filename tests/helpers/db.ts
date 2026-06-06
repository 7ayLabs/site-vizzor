/**
 * Test DB helpers.
 *
 * `withTempDb(fn)` runs `fn` with an isolated SQLite path so a test
 * can opt into a private DB without disturbing the global per-pid
 * default the setup file installs. Useful for tests that want to
 * assert init() idempotency across multiple opens.
 */

import { existsSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const DB_GLOBAL_KEY = Symbol.for('vizzor.site.db');

interface GlobalWithDb {
  [DB_GLOBAL_KEY]?: { close?: () => void };
}

function clearSingleton(): void {
  const g = globalThis as unknown as GlobalWithDb;
  const existing = g[DB_GLOBAL_KEY];
  if (existing && typeof existing.close === 'function') {
    try {
      existing.close();
    } catch {
      // best-effort
    }
  }
  delete g[DB_GLOBAL_KEY];
}

export async function withTempDb<T>(
  fn: (dbPath: string) => Promise<T> | T,
): Promise<T> {
  const path = `/tmp/vizzor-test-tmp-${process.pid}-${randomUUID()}.db`;
  const prior = process.env.VIZZOR_SITE_DB;
  process.env.VIZZOR_SITE_DB = path;
  clearSingleton();
  try {
    return await fn(path);
  } finally {
    clearSingleton();
    if (existsSync(path)) rmSync(path, { force: true });
    if (existsSync(`${path}-wal`)) rmSync(`${path}-wal`, { force: true });
    if (existsSync(`${path}-shm`)) rmSync(`${path}-shm`, { force: true });
    if (prior === undefined) {
      delete process.env.VIZZOR_SITE_DB;
    } else {
      process.env.VIZZOR_SITE_DB = prior;
    }
  }
}

/**
 * Force the next `getDb()` call to re-init from disk. Tests that
 * mutate `process.env.VIZZOR_SITE_DB` directly should call this so
 * the cached singleton does not mask their override.
 */
export function resetDbSingleton(): void {
  clearSingleton();
}
