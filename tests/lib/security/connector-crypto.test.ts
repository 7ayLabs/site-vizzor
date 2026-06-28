import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  encrypt,
  decrypt,
  previewLast4,
  _resetKeyCache,
} from '@/lib/security/connector-crypto';

describe('connector-crypto', () => {
  beforeAll(() => {
    process.env.CONNECTOR_ENC_KEY = randomBytes(32).toString('base64');
  });

  beforeEach(() => {
    _resetKeyCache();
  });

  it('round-trips a typical webhook URL', () => {
    const plaintext = 'https://discord.com/api/webhooks/123456/abcdefg';
    const blob = encrypt(plaintext);
    expect(blob.ciphertext.length).toBeGreaterThan(0);
    expect(blob.iv.length).toBe(12);
    expect(blob.tag.length).toBe(16);
    expect(decrypt(blob)).toBe(plaintext);
  });

  it('uses a fresh IV every call', () => {
    const a = encrypt('payload');
    const b = encrypt('payload');
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('rejects on tampered ciphertext', () => {
    const blob = encrypt('payload');
    const corrupted = {
      ...blob,
      ciphertext: Buffer.concat([blob.ciphertext.subarray(0, -1), Buffer.from([0x00])]),
    };
    expect(() => decrypt(corrupted)).toThrow();
  });

  it('rejects on wrong IV', () => {
    const blob = encrypt('payload');
    const corrupted = { ...blob, iv: randomBytes(12) };
    expect(() => decrypt(corrupted)).toThrow();
  });

  it('rejects on missing CONNECTOR_ENC_KEY', () => {
    const prior = process.env.CONNECTOR_ENC_KEY;
    delete process.env.CONNECTOR_ENC_KEY;
    _resetKeyCache();
    expect(() => encrypt('x')).toThrow(/CONNECTOR_ENC_KEY/);
    process.env.CONNECTOR_ENC_KEY = prior;
    _resetKeyCache();
  });

  it('rejects on wrong-length CONNECTOR_ENC_KEY', () => {
    const prior = process.env.CONNECTOR_ENC_KEY;
    process.env.CONNECTOR_ENC_KEY = Buffer.from('too short').toString('base64');
    _resetKeyCache();
    expect(() => encrypt('x')).toThrow(/32 bytes/);
    process.env.CONNECTOR_ENC_KEY = prior;
    _resetKeyCache();
  });

  it('previewLast4 reveals only the tail', () => {
    expect(previewLast4('abcdef-secret-key-1234')).toBe('●●●● 1234');
    expect(previewLast4('xx')).toBe('●●●● xx');
  });
});
