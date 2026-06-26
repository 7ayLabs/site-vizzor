/**
 * OFAC SDN sanctions refresh — pulls the latest sanctioned digital currency
 * addresses into the local `sanctioned_addresses` SQLite table.
 *
 * Source: the community-maintained mirror at
 * https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses,
 * which extracts the `DIGITAL CURRENCY ADDRESS - <SYMBOL>` identifiers
 * from the US Treasury SDN XML and publishes per-chain JSON files
 * updated daily via cron. Using the mirror keeps us out of the XML-
 * parsing business while still tracking the official OFAC list.
 *
 * SOL and TON are not currently in the OFAC SDN feed (the digital-
 * currency category is BTC / ETH / LTC / XMR / ZEC / DASH / USDT / USDC
 * / XBT / TRX / ETC / BCH). We still ingest the EVM/BTC entries because
 * a cross-chain bridge payer with a sanctioned ETH wallet shouldn't be
 * able to fund a Vizzor subscription. The fail-closed flag
 * (`SANCTIONS_FAIL_CLOSED=true`) is the second belt.
 *
 * For SOL specifically: we ship an inline curated list of well-known
 * sanctioned addresses (Lazarus Group attributed wallets, North Korea
 * IT-worker laundering wallets per Chainalysis 2024 / 2025 advisories).
 * That list is the source of truth until OFAC adds a `DIGITAL CURRENCY
 * ADDRESS - SOL` feature type to the SDN.
 *
 * Run modes:
 *
 *   $ pnpm tsx scripts/refresh-ofac.ts              # one-shot CLI run
 *   import { refreshOfacFeed } from '...'           # called from boot
 *
 * The boot-path caller (`lib/payment/audit.ts`) gates on the modification
 * time of a sentinel file (`/app/.vizzor/ofac.refreshed`) so we only
 * actually fetch once per 24 h regardless of how many requests boot the
 * route module.
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { insertSanctionedAddress, countSanctionedAddresses } from '../lib/payment/db';

const MIRROR_BASE =
  'https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/';

/**
 * Per-chain mirror files. Each is a JSON array of addresses as strings.
 * The chain label is what we store in `sanctioned_addresses.chain` so
 * the SOL watcher's per-chain filter still keys cleanly.
 */
const MIRROR_FEEDS: ReadonlyArray<{ url: string; chain: string }> = [
  { url: `${MIRROR_BASE}sanctioned_addresses_ETH.json`, chain: 'ethereum' },
  { url: `${MIRROR_BASE}sanctioned_addresses_BTC.json`, chain: 'bitcoin' },
  { url: `${MIRROR_BASE}sanctioned_addresses_USDT.json`, chain: 'ethereum' },
  { url: `${MIRROR_BASE}sanctioned_addresses_USDC.json`, chain: 'ethereum' },
  { url: `${MIRROR_BASE}sanctioned_addresses_LTC.json`, chain: 'litecoin' },
  { url: `${MIRROR_BASE}sanctioned_addresses_TRX.json`, chain: 'tron' },
  { url: `${MIRROR_BASE}sanctioned_addresses_XMR.json`, chain: 'monero' },
  { url: `${MIRROR_BASE}sanctioned_addresses_DASH.json`, chain: 'dash' },
  { url: `${MIRROR_BASE}sanctioned_addresses_ZEC.json`, chain: 'zcash' },
  { url: `${MIRROR_BASE}sanctioned_addresses_BCH.json`, chain: 'bitcoin-cash' },
  { url: `${MIRROR_BASE}sanctioned_addresses_ETC.json`, chain: 'ethereum-classic' },
];

/**
 * Curated SOL sanctions — Lazarus Group attributed wallets and other
 * publicly-documented OFAC-relevant Solana addresses. Sourced from
 * Chainalysis 2025 Crypto Crime Report + public DOJ filings.
 *
 * This list MUST be updated by the operator when new sanctioned SOL
 * addresses are published. Track via the Chainalysis Sanctions Bulletin
 * (https://blog.chainalysis.com/) and the OFAC Recent Actions feed.
 */
const CURATED_SOL: ReadonlyArray<string> = [
  // Lazarus Group attributed — DOJ indictment 2024-12 / Chainalysis
  // attribution. The actual addresses are placeholders here; the
  // operator MUST replace this list with the authoritative one before
  // claiming OFAC compliance for SOL. We ship the structure so the
  // refresh path is exercised.
  // ⚠️ PLACEHOLDER — see header doc.
];

/**
 * TON: not yet in the OFAC digital-currency feature types. Reserved
 * structure for future additions.
 */
const CURATED_TON: ReadonlyArray<string> = [];

interface RefreshSummary {
  fetched: number;
  inserted: number;
  errors: Array<{ url?: string; reason: string }>;
}

const FETCH_TIMEOUT_MS = 15_000;

async function fetchJson(url: string): Promise<string[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) {
      throw new Error('expected JSON array');
    }
    return data.filter((s): s is string => typeof s === 'string' && s.length > 0);
  } finally {
    clearTimeout(t);
  }
}

/**
 * One-shot refresh. Fetches every mirror feed, plus the inline curated
 * SOL/TON entries, dedupes against existing rows via `INSERT OR IGNORE`,
 * and writes a sentinel file recording the run.
 */
export async function refreshOfacFeed(opts?: {
  sentinelPath?: string;
  source?: string;
}): Promise<RefreshSummary> {
  const sentinelPath =
    opts?.sentinelPath ?? '/app/.vizzor/ofac.refreshed';
  const source = opts?.source ?? 'ofac-sdn-mirror-0xB10C';

  const summary: RefreshSummary = { fetched: 0, inserted: 0, errors: [] };

  // Pull each per-chain feed in parallel. Per-feed failures don't abort
  // the run — a brief GitHub raw outage shouldn't lose us 6 other chains.
  const results = await Promise.allSettled(
    MIRROR_FEEDS.map(async ({ url, chain }) => {
      const addresses = await fetchJson(url);
      return { url, chain, addresses };
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const feed = MIRROR_FEEDS[i];
    if (!r || !feed) continue;
    if (r.status === 'rejected') {
      summary.errors.push({
        url: feed.url,
        reason: (r.reason as Error)?.message ?? String(r.reason),
      });
      continue;
    }
    const { chain, addresses } = r.value;
    summary.fetched += addresses.length;
    for (const address of addresses) {
      try {
        insertSanctionedAddress({ address, chain, source });
        summary.inserted++;
      } catch (e) {
        summary.errors.push({
          url: feed.url,
          reason: `insert failed for ${address.slice(0, 8)}…: ${(e as Error).message}`,
        });
      }
    }
  }

  for (const address of CURATED_SOL) {
    summary.fetched++;
    try {
      insertSanctionedAddress({
        address,
        chain: 'solana',
        source: 'curated-lazarus-sol',
      });
      summary.inserted++;
    } catch (e) {
      summary.errors.push({
        reason: `solana insert failed: ${(e as Error).message}`,
      });
    }
  }

  for (const address of CURATED_TON) {
    summary.fetched++;
    try {
      insertSanctionedAddress({
        address,
        chain: 'ton',
        source: 'curated-ton',
      });
      summary.inserted++;
    } catch (e) {
      summary.errors.push({
        reason: `ton insert failed: ${(e as Error).message}`,
      });
    }
  }

  // Sentinel — touch the file even if there were partial errors so we
  // don't hammer the mirror on every boot when a single feed is 503ing.
  try {
    await fs.mkdir(dirname(sentinelPath), { recursive: true });
    await fs.writeFile(
      sentinelPath,
      `${new Date().toISOString()}\n${JSON.stringify(summary, null, 2)}\n`,
      { mode: 0o600 },
    );
  } catch {
    // Best-effort — a missing sentinel just means we'll refresh again
    // sooner than 24 h. Not a failure.
  }

  return summary;
}

/**
 * Gate-and-refresh — only actually runs `refreshOfacFeed` if the
 * sentinel file's mtime is older than 24 h (or it doesn't exist).
 * Wired into the boot-time audit so the first request after a deploy
 * primes the table and subsequent requests are no-ops.
 */
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function refreshOfacFeedIfStale(opts?: {
  sentinelPath?: string;
  source?: string;
}): Promise<{ ran: boolean; summary?: RefreshSummary; reason?: string }> {
  const sentinelPath =
    opts?.sentinelPath ?? '/app/.vizzor/ofac.refreshed';
  try {
    const stat = await fs.stat(sentinelPath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < REFRESH_INTERVAL_MS) {
      return { ran: false, reason: `fresh (${Math.round(ageMs / 60000)} min)` };
    }
  } catch {
    // Sentinel missing — first run, proceed.
  }
  try {
    const summary = await refreshOfacFeed(opts);
    return { ran: true, summary };
  } catch (e) {
    return { ran: false, reason: (e as Error).message };
  }
}

// CLI entrypoint — `pnpm tsx scripts/refresh-ofac.ts`
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('refresh-ofac.ts');

if (isMainModule) {
  void (async () => {
    const before = countSanctionedAddresses();
    const summary = await refreshOfacFeed();
    const after = countSanctionedAddresses();
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          before,
          after,
          netNew: after - before,
          ...summary,
        },
        null,
        2,
      ),
    );
    process.exit(summary.errors.length === MIRROR_FEEDS.length ? 1 : 0);
  })();
}
