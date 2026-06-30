/**
 * Static catalog loader for the Directory feature.
 *
 * `data/connectors.json` is the single source of truth for what the
 * UI lists, what the install flow accepts, and what the engine
 * recognizes as a valid skill id. Loaded once at module
 * init and validated with hand-rolled checks (no zod dependency, to
 * match the existing lib/payment/* convention).
 *
 * A malformed entry throws at startup — production deploys catch this
 * at boot, not at the first request. The `scripts/check-directory-
 * parity.mjs` CI hook runs the same validator before merge.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type ConnectorCategory = 'connector' | 'skill';
export type PartnerTier = 'vizzor' | 'partner' | 'community';
export type InstallKind = 'internal' | 'webhook' | 'apikey' | 'skill' | 'mcp';
export type RequiredTier = 'free' | 'pro' | 'elite';

/**
 * Tier hierarchy for catalog access checks. A wallet at `pro` can install
 * entries marked `free` or `pro` but not `elite`. The order is shared with
 * the engine's tier check so install + skill resolution use the same rule.
 */
const TIER_RANK: Record<RequiredTier, number> = { free: 0, pro: 1, elite: 2 };

/**
 * `requiredTier` of `null` means "no caller tier known" (anonymous). It
 * passes only `free` entries. A known tier passes anything at or below
 * its rank.
 */
export function tierSatisfies(
  callerTier: RequiredTier | null,
  required: RequiredTier,
): boolean {
  if (callerTier === null) return required === 'free';
  return TIER_RANK[callerTier] >= TIER_RANK[required];
}

export interface ConfigField {
  name: string;
  label: string;
  placeholder?: string;
  kind: 'url' | 'secret' | 'text';
  pattern?: string;
  required: boolean;
}

export interface ConfigSchema {
  fields: ConfigField[];
}

export interface CatalogEntry {
  id: string;
  slug: string;
  name: string;
  category: ConnectorCategory;
  icon: string;
  summary: string;
  description: string;
  popular_rank: number;
  popular_for: string[];
  partner_tier: PartnerTier;
  install_kind: InstallKind;
  scopes: string[];
  /**
   * v0.4.1 — minimum subscription tier needed to install / activate
   * this entry. Optional in the JSON for backwards compatibility;
   * missing = 'free'. Enforced server-side at the install API and (for
   * skills) at the engine's chat route. Never trust the UI lock — the
   * `locked` flag the catalog API surfaces is purely advisory.
   */
  required_tier: RequiredTier;
  status_text?: string;
  config_schema: ConfigSchema | null;
  external_docs?: string;
}

export interface Catalog {
  version: number;
  generated_at: string;
  entries: CatalogEntry[];
}

const CATALOG_PATH = join(process.cwd(), 'data', 'connectors.json');

let cached: Catalog | null = null;

/* ------------------------------------------------------------------ *\
 * Validation helpers — hand-rolled to keep the dep tree lean. Errors
 * include the entry id so a malformed file is easy to triage at boot.
\* ------------------------------------------------------------------ */

function isString(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0;
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every(isString);
}

const VALID_CATEGORIES = new Set<ConnectorCategory>(['connector', 'skill']);
const VALID_TIERS = new Set<PartnerTier>(['vizzor', 'partner', 'community']);
const VALID_INSTALL_KINDS = new Set<InstallKind>(['internal', 'webhook', 'apikey', 'skill', 'mcp']);
const VALID_REQUIRED_TIERS = new Set<RequiredTier>(['free', 'pro', 'elite']);

function validateField(field: unknown, ctx: string): ConfigField {
  if (!field || typeof field !== 'object') {
    throw new Error(`${ctx}: field must be an object`);
  }
  const f = field as Record<string, unknown>;
  if (!isString(f.name)) throw new Error(`${ctx}: field.name is required`);
  if (!isString(f.label)) throw new Error(`${ctx}: field.label is required`);
  if (f.kind !== 'url' && f.kind !== 'secret' && f.kind !== 'text') {
    throw new Error(`${ctx}: field.kind must be url|secret|text`);
  }
  if (f.required !== true && f.required !== false) {
    throw new Error(`${ctx}: field.required must be boolean`);
  }
  return {
    name: f.name,
    label: f.label,
    placeholder: typeof f.placeholder === 'string' ? f.placeholder : undefined,
    kind: f.kind,
    pattern: typeof f.pattern === 'string' ? f.pattern : undefined,
    required: f.required,
  };
}

function validateEntry(raw: unknown): CatalogEntry {
  if (!raw || typeof raw !== 'object') {
    throw new Error('entry must be an object');
  }
  const e = raw as Record<string, unknown>;
  const ctx = `entry[${typeof e.id === 'string' ? e.id : '?'}]`;
  if (!isString(e.id)) throw new Error(`${ctx}: id is required`);
  if (!isString(e.slug)) throw new Error(`${ctx}: slug is required`);
  if (!isString(e.name)) throw new Error(`${ctx}: name is required`);
  if (!VALID_CATEGORIES.has(e.category as ConnectorCategory)) {
    throw new Error(`${ctx}: category must be one of ${[...VALID_CATEGORIES].join(',')}`);
  }
  if (!isString(e.icon)) throw new Error(`${ctx}: icon is required`);
  if (!isString(e.summary)) throw new Error(`${ctx}: summary is required`);
  if (!isString(e.description)) throw new Error(`${ctx}: description is required`);
  if (typeof e.popular_rank !== 'number') throw new Error(`${ctx}: popular_rank must be number`);
  if (!isStringArray(e.popular_for)) throw new Error(`${ctx}: popular_for must be string[]`);
  if (!VALID_TIERS.has(e.partner_tier as PartnerTier)) {
    throw new Error(`${ctx}: partner_tier must be one of ${[...VALID_TIERS].join(',')}`);
  }
  if (!VALID_INSTALL_KINDS.has(e.install_kind as InstallKind)) {
    throw new Error(`${ctx}: install_kind must be one of ${[...VALID_INSTALL_KINDS].join(',')}`);
  }
  if (!isStringArray(e.scopes)) throw new Error(`${ctx}: scopes must be string[]`);
  // required_tier defaults to 'free' so the existing JSON file stays
  // valid without bumping every entry at once.
  const rawTier = e.required_tier;
  if (
    rawTier !== undefined &&
    rawTier !== null &&
    !VALID_REQUIRED_TIERS.has(rawTier as RequiredTier)
  ) {
    throw new Error(
      `${ctx}: required_tier must be one of ${[...VALID_REQUIRED_TIERS].join(',')}`,
    );
  }
  const required_tier: RequiredTier = (rawTier as RequiredTier | undefined) ?? 'free';

  let configSchema: ConfigSchema | null = null;
  if (e.config_schema !== null && e.config_schema !== undefined) {
    if (typeof e.config_schema !== 'object') {
      throw new Error(`${ctx}: config_schema must be object or null`);
    }
    const cs = e.config_schema as Record<string, unknown>;
    if (!Array.isArray(cs.fields)) {
      throw new Error(`${ctx}: config_schema.fields must be array`);
    }
    configSchema = {
      fields: cs.fields.map((f, i) => validateField(f, `${ctx}.fields[${i}]`)),
    };
  }

  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    category: e.category as ConnectorCategory,
    icon: e.icon,
    summary: e.summary,
    description: e.description,
    popular_rank: e.popular_rank,
    popular_for: e.popular_for,
    partner_tier: e.partner_tier as PartnerTier,
    install_kind: e.install_kind as InstallKind,
    scopes: e.scopes,
    required_tier,
    status_text: typeof e.status_text === 'string' ? e.status_text : undefined,
    config_schema: configSchema,
    external_docs: typeof e.external_docs === 'string' ? e.external_docs : undefined,
  };
}

function validateCatalog(raw: unknown): Catalog {
  if (!raw || typeof raw !== 'object') {
    throw new Error('catalog root must be an object');
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.version !== 'number') throw new Error('catalog.version must be number');
  if (!isString(c.generated_at)) throw new Error('catalog.generated_at must be string');
  if (!Array.isArray(c.entries)) throw new Error('catalog.entries must be array');

  const entries = c.entries.map(validateEntry);
  const ids = new Set<string>();
  for (const e of entries) {
    if (ids.has(e.id)) throw new Error(`duplicate entry id: ${e.id}`);
    ids.add(e.id);
  }
  return { version: c.version, generated_at: c.generated_at, entries };
}

export function loadCatalog(): Catalog {
  if (cached) return cached;
  const json = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  cached = validateCatalog(json);
  return cached;
}

/** Test-only: drop the cached catalog so a test can swap the file. */
export function _resetCatalogCache(): void {
  cached = null;
}

/* ------------------------------------------------------------------ *\
 * Convenience getters — used by the API + UI surfaces.
\* ------------------------------------------------------------------ */

export function getEntry(id: string): CatalogEntry | null {
  return loadCatalog().entries.find((e) => e.id === id) ?? null;
}

export function getEntriesByCategory(category: ConnectorCategory): CatalogEntry[] {
  return loadCatalog().entries.filter((e) => e.category === category);
}

export function isKnownSkill(id: string): boolean {
  const entry = getEntry(id);
  return entry !== null && entry.category === 'skill';
}

export function isKnownConnector(id: string): boolean {
  const entry = getEntry(id);
  return entry !== null;
}
