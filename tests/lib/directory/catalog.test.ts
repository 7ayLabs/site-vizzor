import { describe, it, expect } from 'vitest';
import {
  loadCatalog,
  getEntry,
  getEntriesByCategory,
  isKnownSkill,
} from '@/lib/directory/catalog';
import {
  validateInstallPayload,
  InstallValidationError,
  serializeForEncryption,
} from '@/lib/directory/validate';

describe('catalog', () => {
  it('loads and validates data/connectors.json at boot', () => {
    const cat = loadCatalog();
    expect(cat.version).toBe(1);
    expect(cat.entries.length).toBeGreaterThan(0);
  });

  it('contains all v1 ship categories', () => {
    expect(getEntriesByCategory('connector').length).toBeGreaterThanOrEqual(4);
    expect(getEntriesByCategory('skill').length).toBeGreaterThanOrEqual(4);
    expect(getEntriesByCategory('plugin').length).toBeGreaterThanOrEqual(3);
  });

  it('has Telegram pre-installed as the popular #1', () => {
    const tg = getEntry('telegram');
    expect(tg).not.toBeNull();
    expect(tg?.install_kind).toBe('internal');
    expect(tg?.popular_rank).toBe(1);
  });

  it('recognizes a known skill id', () => {
    expect(isKnownSkill('memecoin-sniper')).toBe(true);
    expect(isKnownSkill('discord-webhook')).toBe(false);
    expect(isKnownSkill('nonexistent')).toBe(false);
  });

  it('all popular_rank values are positive integers', () => {
    for (const e of loadCatalog().entries) {
      expect(Number.isInteger(e.popular_rank)).toBe(true);
      expect(e.popular_rank).toBeGreaterThan(0);
    }
  });
});

describe('validate', () => {
  it('accepts a Discord webhook URL matching the pattern', () => {
    const entry = getEntry('discord-webhook')!;
    const valid = validateInstallPayload(entry, {
      webhook_url: 'https://discord.com/api/webhooks/123/abc',
    });
    expect(valid).toEqual({ webhook_url: 'https://discord.com/api/webhooks/123/abc' });
  });

  it('rejects a Discord URL that does not match the pattern', () => {
    const entry = getEntry('discord-webhook')!;
    expect(() =>
      validateInstallPayload(entry, { webhook_url: 'https://example.com/x' }),
    ).toThrow(InstallValidationError);
  });

  it('rejects non-https URL fields', () => {
    const entry = getEntry('generic-webhook')!;
    expect(() =>
      validateInstallPayload(entry, { webhook_url: 'http://example.com/x' }),
    ).toThrow(InstallValidationError);
  });

  it('rejects missing required field', () => {
    const entry = getEntry('helius-rpc')!;
    expect(() => validateInstallPayload(entry, {})).toThrow(InstallValidationError);
  });

  it('returns null for entries with no config_schema (skills)', () => {
    const entry = getEntry('memecoin-sniper')!;
    expect(validateInstallPayload(entry, {})).toBeNull();
  });

  it('serializes payload with stable key order', () => {
    expect(serializeForEncryption({ b: '1', a: '2' })).toBe('{"a":"2","b":"1"}');
  });
});
