/**
 * AES-256-GCM at-rest encryption for connector credentials.
 *
 * Credentials (webhook URLs, API keys) are stored in `user_connections`
 * as three columns — `credentials_ciphertext`, `credentials_iv`,
 * `credentials_tag` — so the cipher, IV, and auth tag are independently
 * inspectable for debugging and migration. The 256-bit key lives in the
 * `CONNECTOR_ENC_KEY` env var (base64, 32 bytes); operators rotate by
 * standing up the new key alongside the old one and re-encrypting in a
 * one-shot script (`scripts/rotate-connector-key.mjs`, not yet shipped).
 *
 * Threat model: a database snapshot (theft, accidental backup leak)
 * must not yield plaintext credentials. The key is held only in the
 * application process memory; the DB never sees it.
 *
 * GCM provides authenticated encryption — `decrypt()` throws on tag
 * mismatch (tamper) or wrong IV, so we don't need a separate HMAC. Each
 * row gets a fresh 12-byte IV per NIST SP 800-38D §8.2.1 (random IVs
 * are safe up to ~2^32 messages per key, which we will never approach).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.CONNECTOR_ENC_KEY;
  if (!raw) {
    throw new Error(
      'CONNECTOR_ENC_KEY is not set — refusing to encrypt connector credentials. ' +
        'Generate one with `openssl rand -base64 32` and put it in the deploy env.',
    );
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `CONNECTOR_ENC_KEY must decode to ${KEY_BYTES} bytes (got ${buf.length}). ` +
        'Generate one with `openssl rand -base64 32`.',
    );
  }
  cachedKey = buf;
  return buf;
}

/** Test-only: drop the cached key so an env-var change is observed. */
export function _resetKeyCache(): void {
  cachedKey = null;
}

export interface EncryptedBlob {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

/**
 * Encrypt a plaintext string. Returns the three components that the
 * `user_connections` row stores separately. Caller serializes nothing
 * to JSON — the column types are BLOB, the values are raw buffers.
 */
export function encrypt(plaintext: string): EncryptedBlob {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_BYTES) {
    throw new Error(`GCM auth tag must be ${TAG_BYTES} bytes (got ${tag.length})`);
  }
  return { ciphertext, iv, tag };
}

/**
 * Decrypt a stored blob. Throws on tamper (`bad decrypt`) or wrong
 * key — callers should let the error bubble and return a generic 500
 * to the user rather than leak details.
 */
export function decrypt(blob: EncryptedBlob): string {
  const key = loadKey();
  const decipher = createDecipheriv(ALGORITHM, key, blob.iv);
  decipher.setAuthTag(blob.tag);
  const plaintext = Buffer.concat([
    decipher.update(blob.ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/**
 * UI-safe preview of a credential: 4 leading `●` + the last 4 chars of
 * the plaintext. Used on the Directory card so users can recognize
 * which key is installed without exposing the full secret.
 */
export function previewLast4(plaintext: string): string {
  const tail = plaintext.length >= 4 ? plaintext.slice(-4) : plaintext;
  return `●●●● ${tail}`;
}
