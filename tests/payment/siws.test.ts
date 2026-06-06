/**
 * siws.ts — Sign-In With Solana canonical message + ed25519 verify.
 *
 * Asserts:
 *   - the canonical message contains every required CAIP-122 line
 *   - the Action: line is present and scoped correctly (Login /
 *     Link Wallet)
 *   - a wallet-signed message verifies; cross-action substitution
 *     does not
 *   - signature shape and wallet length checks fail closed
 */

import { describe, it, expect } from 'vitest';
import {
  buildSiwsMessage,
  isValidSolanaAddress,
  parseSiwsAction,
  siwsActionLabel,
  verifySiwsSignature,
} from '@/lib/payment/siws';
import {
  buildSignedSiws,
  generateTestKeypair,
  signMessage,
} from '../helpers/keypair';

describe('buildSiwsMessage canonical structure', () => {
  it('contains every required CAIP-122 line', () => {
    const kp = generateTestKeypair();
    const issuedAt = new Date('2026-06-01T00:00:00.000Z');
    const expiresAt = new Date('2026-06-01T00:05:00.000Z');
    const msg = buildSiwsMessage({
      wallet: kp.walletAddress,
      nonce: 'abcd1234',
      action: 'login',
      issuedAt,
      expiresAt,
    });
    expect(msg).toContain('vizzor.ai wants you to sign in');
    expect(msg).toContain(kp.walletAddress);
    expect(msg).toContain('URI: https://vizzor.ai');
    expect(msg).toContain('Chain ID: solana:mainnet');
    expect(msg).toContain('Nonce: abcd1234');
    expect(msg).toContain('Issued At: 2026-06-01T00:00:00.000Z');
    expect(msg).toContain('Expiration Time: 2026-06-01T00:05:00.000Z');
  });

  it('embeds the Action: line per scope', () => {
    const kp = generateTestKeypair();
    const base = {
      wallet: kp.walletAddress,
      nonce: 'n',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    };
    expect(buildSiwsMessage({ ...base, action: 'login' })).toContain(
      'Action: Login',
    );
    expect(buildSiwsMessage({ ...base, action: 'link' })).toContain(
      'Action: Link Wallet',
    );
  });

  it('login and link messages produce different bytes for the same nonce', () => {
    const kp = generateTestKeypair();
    const base = {
      wallet: kp.walletAddress,
      nonce: 'sharedNonce',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    };
    const login = buildSiwsMessage({ ...base, action: 'login' });
    const link = buildSiwsMessage({ ...base, action: 'link' });
    expect(login).not.toBe(link);
  });
});

describe('verifySiwsSignature roundtrip', () => {
  it('verifies a wallet-signed login message', () => {
    const kp = generateTestKeypair();
    const signed = buildSignedSiws({ keypair: kp, nonce: 'roundtrip' });
    expect(verifySiwsSignature(signed.message, signed.signature, kp.walletAddress)).toBe(
      true,
    );
  });

  it('rejects a signature against a tampered message', () => {
    const kp = generateTestKeypair();
    const signed = buildSignedSiws({ keypair: kp, nonce: 'orig' });
    const tampered = signed.message.replace('Login', 'Link Wallet');
    expect(verifySiwsSignature(tampered, signed.signature, kp.walletAddress)).toBe(
      false,
    );
  });

  it('rejects a signature from a different keypair', () => {
    const owner = generateTestKeypair();
    const intruder = generateTestKeypair();
    const ownerSig = buildSignedSiws({ keypair: owner, nonce: 'n' });
    expect(
      verifySiwsSignature(ownerSig.message, ownerSig.signature, intruder.walletAddress),
    ).toBe(false);
  });

  it('rejects truncated or malformed signatures', () => {
    const kp = generateTestKeypair();
    const m = buildSiwsMessage({
      wallet: kp.walletAddress,
      nonce: 'n',
      action: 'login',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(verifySiwsSignature(m, 'not-a-signature', kp.walletAddress)).toBe(
      false,
    );
    expect(verifySiwsSignature(m, '', kp.walletAddress)).toBe(false);
  });

  it('cross-action: a signature over Login does not verify a Link message', () => {
    const kp = generateTestKeypair();
    // Sign a Login message ourselves
    const loginMsg = buildSiwsMessage({
      wallet: kp.walletAddress,
      nonce: 'n',
      action: 'login',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const loginSig = signMessage(loginMsg, kp.secretKey);

    // Build the link counterpart with the same nonce + timestamps.
    const linkMsg = buildSiwsMessage({
      wallet: kp.walletAddress,
      nonce: 'n',
      action: 'link',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    // The login signature MUST NOT verify the link message.
    expect(verifySiwsSignature(linkMsg, loginSig, kp.walletAddress)).toBe(false);
  });
});

describe('parseSiwsAction', () => {
  it('accepts the enum values', () => {
    expect(parseSiwsAction('login')).toBe('login');
    expect(parseSiwsAction('link')).toBe('link');
  });

  it('rejects every other input', () => {
    expect(parseSiwsAction('Login')).toBeNull();
    expect(parseSiwsAction('admin')).toBeNull();
    expect(parseSiwsAction('')).toBeNull();
    expect(parseSiwsAction(null)).toBeNull();
    expect(parseSiwsAction(undefined)).toBeNull();
    expect(parseSiwsAction({})).toBeNull();
  });
});

describe('siwsActionLabel', () => {
  it('maps enum to canonical message label', () => {
    expect(siwsActionLabel('login')).toBe('Login');
    expect(siwsActionLabel('link')).toBe('Link Wallet');
  });
});

describe('isValidSolanaAddress', () => {
  it('accepts a real base58 32-byte key', () => {
    const kp = generateTestKeypair();
    expect(isValidSolanaAddress(kp.walletAddress)).toBe(true);
  });

  it('rejects empty / short / wrong-length inputs', () => {
    expect(isValidSolanaAddress('')).toBe(false);
    expect(isValidSolanaAddress('abc')).toBe(false);
    expect(isValidSolanaAddress('!!!')).toBe(false);
  });
});
