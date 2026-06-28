/**
 * Per-entry install-payload validation.
 *
 * Each catalog entry declares a `config_schema` describing the fields
 * the install form collects. This module validates the inbound POST
 * body against that schema, applying:
 *
 *   - required-field presence
 *   - kind-specific checks (url → must parse, secret → length cap)
 *   - optional pattern (Discord/Slack regex)
 *
 * Validation errors are normalized to a single `reason` string so
 * the API returns `{ ok: false, reason: 'invalid_<field>' }` — never
 * the raw error message (anti-enumeration).
 */

import type { CatalogEntry } from './catalog';

const SECRET_MAX_BYTES = 4096;

export class InstallValidationError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
    this.name = 'InstallValidationError';
  }
}

/**
 * Validate the raw `credentials` object the client sent for an install
 * against the entry's `config_schema`. Returns the validated subset
 * (only declared fields, in the order the schema lists them). Throws
 * InstallValidationError on the first failure.
 *
 * Returns `null` for entries with no config_schema (skills, telegram).
 */
export function validateInstallPayload(
  entry: CatalogEntry,
  payload: unknown,
): Record<string, string> | null {
  if (entry.config_schema === null) return null;

  if (!payload || typeof payload !== 'object') {
    throw new InstallValidationError('invalid_payload');
  }
  const body = payload as Record<string, unknown>;
  const out: Record<string, string> = {};

  for (const field of entry.config_schema.fields) {
    const value = body[field.name];

    if (value === undefined || value === null || value === '') {
      if (field.required) {
        throw new InstallValidationError(`missing_${field.name}`);
      }
      continue;
    }
    if (typeof value !== 'string') {
      throw new InstallValidationError(`invalid_${field.name}`);
    }
    if (value.length > SECRET_MAX_BYTES) {
      throw new InstallValidationError(`invalid_${field.name}`);
    }

    if (field.kind === 'url') {
      try {
        const url = new URL(value);
        if (url.protocol !== 'https:') {
          throw new InstallValidationError(`invalid_${field.name}`);
        }
      } catch (err) {
        if (err instanceof InstallValidationError) throw err;
        throw new InstallValidationError(`invalid_${field.name}`);
      }
    }
    if (field.pattern) {
      const re = new RegExp(field.pattern);
      if (!re.test(value)) {
        throw new InstallValidationError(`invalid_${field.name}`);
      }
    }

    out[field.name] = value;
  }
  return out;
}

/**
 * Serialize the validated payload to a single string for AES-GCM
 * encryption. Stable key ordering so a future re-encryption hash
 * comparison is deterministic.
 */
export function serializeForEncryption(payload: Record<string, string>): string {
  const keys = Object.keys(payload).sort();
  const ordered = keys.map((k) => [k, payload[k]] as const);
  return JSON.stringify(Object.fromEntries(ordered));
}
