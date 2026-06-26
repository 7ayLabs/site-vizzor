/**
 * Wallet-scoped payment history queries.
 *
 * Backs the /app/billing surface. Always filter by `payer_address`
 * server-side — the route is SIWS-gated, but defense-in-depth means
 * the query primitive itself never returns another wallet's rows.
 *
 * The query is read-only; lives outside `db.ts` to keep that file
 * focused on schema + base CRUD. Re-exports the canonical `SessionRow`
 * type so consumers don't pull from two modules.
 */

import { getDb, type SessionRow } from './db';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Confirmed payment sessions for a wallet, newest first.
 *
 * Filters:
 *   - `payer_address = ?` — wallet boundary (load-bearing for authz).
 *   - `status = 'confirmed'` — pending/expired/failed sessions are
 *     operational noise; users care about settled payments.
 *
 * Limit is clamped to `MAX_LIMIT` to prevent a hostile client from
 * forcing an unbounded read.
 */
export function listConfirmedSessionsByWallet(
  wallet: string,
  limit = DEFAULT_LIMIT,
): SessionRow[] {
  const clamped = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
  return getDb()
    .prepare(
      `SELECT * FROM payment_sessions
        WHERE payer_address = ? AND status = 'confirmed'
        ORDER BY confirmed_at DESC, created_at DESC
        LIMIT ?`,
    )
    .all(wallet, clamped) as SessionRow[];
}
