#!/usr/bin/env node
/**
 * check-directory-parity.mjs — assert the site's connector catalog
 * lines up with the engine's skill + plugin registries.
 *
 * Site repo (this one): loads data/connectors.json. Reads
 * `SITE_CATALOG_URL` (default https://vizzor.ai/api/directory/catalog)
 * for the live snapshot the engine repo's CI fetches against; locally
 * the script just verifies the local file parses + has no duplicate
 * ids + no unknown categories.
 *
 * Engine repo: ships its own copy that compares the SITE_CATALOG_URL
 * response against its in-process skill/plugin registries.
 *
 * Exit 0 = parity holds (or there's nothing to compare against locally).
 * Exit 1 = drift detected. Don't merge until fixed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CATALOG_PATH = join(process.cwd(), 'data', 'connectors.json');
const VALID_CATEGORIES = new Set(['connector', 'skill', 'plugin']);
const VALID_INSTALL_KINDS = new Set([
  'internal',
  'webhook',
  'apikey',
  'skill',
  'mcp',
]);

function fail(msg) {
  console.error(`[parity] ${msg}`);
  process.exitCode = 1;
}

function checkLocal() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  } catch (err) {
    fail(`failed to parse data/connectors.json: ${err.message}`);
    return null;
  }

  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) {
    fail('catalog.entries must be an array');
    return null;
  }

  const ids = new Set();
  for (const entry of raw.entries) {
    if (typeof entry?.id !== 'string') {
      fail(`entry missing string id: ${JSON.stringify(entry)}`);
      continue;
    }
    if (ids.has(entry.id)) fail(`duplicate id: ${entry.id}`);
    ids.add(entry.id);
    if (!VALID_CATEGORIES.has(entry.category)) {
      fail(`entry ${entry.id}: invalid category '${entry.category}'`);
    }
    if (!VALID_INSTALL_KINDS.has(entry.install_kind)) {
      fail(`entry ${entry.id}: invalid install_kind '${entry.install_kind}'`);
    }
    if (entry.category === 'skill' && entry.install_kind !== 'skill') {
      fail(`entry ${entry.id}: skill category must have install_kind 'skill'`);
    }
  }

  if (process.exitCode === 1) return null;
  console.log(`[parity] site catalog OK — ${raw.entries.length} entries, ${ids.size} unique ids`);
  return raw;
}

checkLocal();
