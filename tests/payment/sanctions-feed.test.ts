/**
 * OFAC sanctions feed refresh — placeholder.
 *
 * Stream A is implementing `scripts/refresh-ofac.ts` that:
 *   1. Pulls https://www.treasury.gov/ofac/downloads/sdn.csv
 *   2. Parses the CSV (Pandas-style fixed columns)
 *   3. Filters for SOL-format (base58) + TON-format addresses
 *   4. Upserts into the `sanctioned_addresses` SQLite table
 *   5. Wires into `lib/payment/audit.ts` startup audit so a feed
 *      older than 24h triggers a refresh
 *
 * The script does NOT exist yet at the time this test file lands.
 * Everything below is `.todo` so the suite never red-bars while
 * Stream A's PR is in flight. Once the script ships, payment-qa
 * promotes each `.todo` to a real assertion against a fixture CSV
 * + a tmp SQLite database (the same setup the address-pool tests
 * use, see `tests/payment/address-pool.test.ts`).
 *
 * Coverage queue (from the mainnet-launch plan §P0 #2):
 *   - Refresh is idempotent — running twice with the same CSV is a
 *     no-op on the second run.
 *   - Malformed CSV rows are skipped with a metric, never crash.
 *   - sha256 of the CSV bytes is verified against a pinned digest
 *     before parsing (operator records the digest out-of-band per
 *     `docs/security/treasury-threat-model.md`).
 *   - Stale feed (mtime > 24h) triggers a refresh on next audit
 *     and refuses to start (fail-closed) when SANCTIONS_FAIL_CLOSED=true.
 *   - Address normalization: SOL base58 case is preserved, TON raw
 *     `workchain:hex` is lowercased.
 *   - A wallet flagged in the table is rejected at session-create
 *     with `reason: 'sanctioned'` and a blocking audit log entry.
 */

import { describe, it } from 'vitest';

describe('OFAC sanctions feed (placeholder — Stream A ships scripts/refresh-ofac.ts)', () => {
  describe('CSV ingest', () => {
    it.todo('upserts SOL-format addresses from a fixture sdn.csv');
    it.todo('upserts TON-format addresses from a fixture sdn.csv');
    it.todo('skips malformed CSV rows without throwing');
    it.todo('is idempotent — second run with the same CSV is a no-op');
  });

  describe('integrity', () => {
    it.todo('refuses to ingest when sha256 of the CSV does not match the pinned digest');
    it.todo('logs a structured audit event on every refresh');
  });

  describe('audit gate', () => {
    it.todo(
      'audit startup refreshes when sanctioned_addresses feed mtime > 24h',
    );
    it.todo(
      'audit fail-closed when SANCTIONS_FAIL_CLOSED=true and the feed cannot be loaded',
    );
  });

  describe('enforcement', () => {
    it.todo(
      'createSession rejects with reason=sanctioned when payer wallet matches',
    );
    it.todo(
      'audit log entry is written BEFORE the rejection response (blocking, not fire-and-forget)',
    );
  });
});
