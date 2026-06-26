/**
 * OFAC / sanctions screen for payer wallets (v0.2.x security slice).
 *
 * The Solana watcher matches an on-chain transfer to a pending session,
 * then calls `screenPayer(payer, chain)` before `finalizeSession`. A hit
 * → the payment is rejected, the session is marked `failed`, and the
 * payer is logged into `audit_log` for the operator's compliance trail.
 *
 * Two ways an address ends up in `sanctioned_addresses`:
 *
 *   1. Seed list — a small set of well-known OFAC SDN-listed addresses
 *      (Tornado Cash deposits, Hydra DNM operator wallets, Lazarus
 *      group hops) committed to source. Loaded into the DB on first
 *      boot via `seedSanctionedAddresses()` and only if the table is
 *      empty. The seed is intentionally minimal — it's a sample, not a
 *      claimed-complete sanctions feed.
 *
 *   2. Operator additions — the operator may add addresses by calling
 *      `db.insertSanctionedAddress()` directly. v0.3.x will add an
 *      admin route + a daily fetch from the public OFAC SDN CSV with
 *      a delta-merge into this table.
 *
 * The screen is fail-OPEN by design for operational simplicity: if
 * the DB is unreachable, payments still confirm. The threat model
 * (RFC §A1.3) treats sanctioned-payer acceptance as a compliance
 * concern, not a security one — there is no immediate user harm, so
 * making the watcher unusable on DB hiccups would be a worse trade.
 * If/when a regulator audit demands stricter behavior, flip
 * `SANCTIONS_FAIL_CLOSED=true` and the screen will deny on error.
 */

import { isSanctionedAddress, insertSanctionedAddress, countSanctionedAddresses } from './db';

const FAIL_CLOSED = process.env.SANCTIONS_FAIL_CLOSED === 'true';

/**
 * Minimal seed list — public OFAC SDN entries that are commonly cited in
 * sanctions tutorials. NOT a complete feed; the operator is expected to
 * pull the full SDN CSV monthly and call `insertSanctionedAddress` to
 * extend this table.
 *
 * Sources:
 *   - US Treasury OFAC SDN list (https://sanctionssearch.ofac.treas.gov/)
 *   - Tornado Cash sanctioned deposit contracts (August 2022)
 *   - Lazarus Group attributed addresses (various)
 *
 * Each entry includes the chain so a Solana watcher doesn't reject an
 * ETH-shaped address that happens to base58-decode cleanly. The
 * fallback chain-agnostic lookup in `isSanctionedAddress()` is a
 * belt-and-braces defense for cross-chain bridge payers.
 */
const SEED_SANCTIONS: ReadonlyArray<{
  address: string;
  chain: string;
  source: string;
}> = [
  // Tornado Cash sanctioned deposit contracts — OFAC SDN August 2022.
  // ETH addresses. Listed here so a future EVM watcher inherits the screen.
  {
    address: '0x8589427373D6D84E98730D7795D8f6f8731FDA16',
    chain: 'ethereum',
    source: 'ofac-sdn-tornado',
  },
  {
    address: '0x722122dF12D4e14e13Ac3b6895a86e84145b6967',
    chain: 'ethereum',
    source: 'ofac-sdn-tornado',
  },
  {
    address: '0xDD4c48C0B24039969fC16D1cdF626eaB821d3384',
    chain: 'ethereum',
    source: 'ofac-sdn-tornado',
  },
  // Lazarus Group attributed Solana wallets (illustrative — replace
  // with the operator's authoritative list before any production claim).
  {
    address: 'DEADbEEFLazarusPlaceholderForSeedTesting11111',
    chain: 'solana',
    source: 'ofac-sdn-lazarus',
  },
];

/**
 * Idempotent seeding. Runs on the watcher's first tick (and any other
 * boot path that calls `screenPayer`). If the table already has rows
 * we leave it alone — the operator may have curated it manually.
 *
 * Also triggers a lazy OFAC SDN refresh from the community mirror —
 * gated to 24h via sentinel file, fire-and-forget so a slow mirror
 * doesn't block the first payment. The refresh module is only imported
 * here (a Node-only code path that touches SQLite) so the edge-runtime
 * bundle never sees it.
 */
let seeded = false;
let refreshKicked = false;
export function ensureSeeded(): void {
  if (seeded) return;
  try {
    const have = countSanctionedAddresses();
    if (have === 0) {
      for (const row of SEED_SANCTIONS) {
        insertSanctionedAddress(row);
      }
    }
  } catch {
    // Fail-open on seed errors — see header doc.
  }
  seeded = true;

  // Kick off a lazy OFAC refresh exactly once per process. Wrapped in
  // a try so a missing scripts/refresh-ofac module never blocks the
  // sanctions screen. Fire-and-forget — the table already has the
  // seed list as a floor while the refresh is in flight.
  if (!refreshKicked) {
    refreshKicked = true;
    void (async () => {
      try {
        const mod = await import('./ofac-feed');
        const r = await mod.refreshOfacFeedIfStale();
        if (r.ran && r.summary) {
          // eslint-disable-next-line no-console
          console.info(
            `[ofac] refresh ok — inserted ${r.summary.inserted} addresses (errors: ${r.summary.errors.length})`,
          );
        } else if (r.reason) {
          // eslint-disable-next-line no-console
          console.info(`[ofac] refresh skipped — ${r.reason}`);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[ofac] refresh failed:', (e as Error)?.message ?? e);
      }
    })();
  }
}

export type ScreenOutcome =
  | { ok: true }
  | { ok: false; reason: 'sanctioned'; address: string; chain: string };

/**
 * Screen a payer address against the local sanctions denylist. Returns
 * `{ ok: true }` for an unsanctioned payer (the happy path) and a
 * structured rejection for a sanctioned payer the caller should refuse
 * to finalize.
 *
 * On DB error: returns `{ ok: true }` unless `SANCTIONS_FAIL_CLOSED=true`,
 * in which case the screen denies. See header doc for rationale.
 */
export function screenPayer(payer: string, chain: string): ScreenOutcome {
  if (!payer) return { ok: true };
  ensureSeeded();
  try {
    if (isSanctionedAddress(payer, chain)) {
      return { ok: false, reason: 'sanctioned', address: payer, chain };
    }
    // Cross-chain belt-and-braces — see header doc.
    if (isSanctionedAddress(payer)) {
      return { ok: false, reason: 'sanctioned', address: payer, chain };
    }
    return { ok: true };
  } catch {
    if (FAIL_CLOSED) {
      return { ok: false, reason: 'sanctioned', address: payer, chain };
    }
    return { ok: true };
  }
}
