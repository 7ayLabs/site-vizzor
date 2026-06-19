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
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {
  buildSiwsMessage,
  isValidSolanaAddress,
  parseSiwsAction,
  parseSiwsMessageString,
  siwsActionFromStatement,
  siwsActionLabel,
  verifySiwsSignature,
  verifySiwsSignatureBytes,
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
    // SIWS spec compliance: the message must NOT contain non-standard
    // fields. `Action:` was a previous extension that broke Phantom's
    // strict parser; action is now carried in the standard `statement`.
    expect(msg).not.toMatch(/^Action:/m);
  });

  it('binds scope via the SIWS `statement` line per action', () => {
    const kp = generateTestKeypair();
    const base = {
      wallet: kp.walletAddress,
      nonce: 'n',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    };
    // Login + link statements differ → signed bytes differ → cross-
    // action signature replay is blocked. Statements deliberately do
    // NOT reference any brand domain (e.g. "vizzor.ai"): Phantom's
    // phishing protection rejects sign requests whose statement
    // claims a domain different from the page origin and the failure
    // surfaces as the generic `"Unexpected error"`. Keep both strings
    // domain-agnostic.
    expect(buildSiwsMessage({ ...base, action: 'login' })).toContain(
      'Authenticate this wallet to start your Vizzor session.',
    );
    expect(buildSiwsMessage({ ...base, action: 'link' })).toContain(
      'Link this wallet to your Vizzor account.',
    );
    // The statement specifically must NOT name a brand domain — see
    // the Phantom phishing-protection note on ACTION_STATEMENTS.
    expect(
      buildSiwsMessage({ ...base, action: 'login' }),
    ).not.toContain('Sign in to vizzor.ai');
    expect(
      buildSiwsMessage({ ...base, action: 'link' }),
    ).not.toContain('Link wallet to vizzor.ai');
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
    // Statement edit changes the SIWS bytes; the original signature
    // no longer verifies against the modified message.
    const tampered = signed.message.replace(
      'Authenticate this wallet to start your Vizzor session.',
      'Link this wallet to your Vizzor account.',
    );
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

describe('parseSiwsMessageString', () => {
  it('round-trips with buildSiwsMessage', () => {
    const kp = generateTestKeypair();
    const issuedAt = new Date('2026-06-01T00:00:00.000Z');
    const expiresAt = new Date('2026-06-01T00:05:00.000Z');
    const msg = buildSiwsMessage({
      wallet: kp.walletAddress,
      nonce: 'parse-rt',
      action: 'login',
      issuedAt,
      expiresAt,
      domain: 'localhost:3000',
      uri: 'http://localhost:3000',
      chainId: 'solana:devnet',
    });
    const parsed = parseSiwsMessageString(msg);
    expect(parsed).not.toBeNull();
    expect(parsed?.domain).toBe('localhost:3000');
    expect(parsed?.address).toBe(kp.walletAddress);
    expect(parsed?.statement).toBe(
      'Authenticate this wallet to start your Vizzor session.',
    );
    expect(parsed?.uri).toBe('http://localhost:3000');
    expect(parsed?.version).toBe('1');
    expect(parsed?.chainId).toBe('solana:devnet');
    expect(parsed?.nonce).toBe('parse-rt');
    expect(parsed?.issuedAt).toBe('2026-06-01T00:00:00.000Z');
    expect(parsed?.expirationTime).toBe('2026-06-01T00:05:00.000Z');
  });

  it('tolerates an extra wallet-prefixed line', () => {
    // Wallets are allowed by the SIWS spec to prepend bytes before
    // signing. The parser must still locate the SIWS body.
    const kp = generateTestKeypair();
    const body = buildSiwsMessage({
      wallet: kp.walletAddress,
      nonce: 'tolerant',
      action: 'login',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const prefixed = `Domain confirmation: vizzor.ai\n${body}`;
    const parsed = parseSiwsMessageString(prefixed);
    expect(parsed?.nonce).toBe('tolerant');
    expect(parsed?.address).toBe(kp.walletAddress);
  });

  it('returns null when the preamble is missing', () => {
    expect(parseSiwsMessageString('hello world')).toBeNull();
    expect(parseSiwsMessageString('')).toBeNull();
  });

  it('returns null when the Nonce field is absent', () => {
    const kp = generateTestKeypair();
    const broken = [
      `vizzor.ai wants you to sign in with your Solana account:`,
      kp.walletAddress,
      '',
      'Authenticate this wallet to start your Vizzor session.',
      '',
      'URI: https://vizzor.ai',
      'Version: 1',
    ].join('\n');
    expect(parseSiwsMessageString(broken)).toBeNull();
  });
});

describe('siwsActionFromStatement', () => {
  it('maps the canonical statements to their actions', () => {
    expect(
      siwsActionFromStatement(
        'Authenticate this wallet to start your Vizzor session.',
      ),
    ).toBe('login');
    expect(
      siwsActionFromStatement('Link this wallet to your Vizzor account.'),
    ).toBe('link');
  });

  it('rejects unknown statements and null', () => {
    expect(siwsActionFromStatement('Sign in to evil.tld')).toBeNull();
    expect(siwsActionFromStatement('')).toBeNull();
    expect(siwsActionFromStatement(null)).toBeNull();
  });
});

describe('verifySiwsSignatureBytes', () => {
  it('verifies bytes the wallet actually signed (signIn path)', () => {
    // Simulates Wallet Standard signIn: the wallet builds the body
    // itself (possibly with a different domain than the server would
    // pick) and signs *those* bytes. The server verifies against the
    // returned bytes — not a reconstruction.
    const kp = generateTestKeypair();
    const walletBuilt = buildSiwsMessage({
      wallet: kp.walletAddress,
      nonce: 'siws-bytes',
      action: 'login',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      domain: 'localhost:3000',
      uri: 'http://localhost:3000',
      chainId: 'solana:devnet',
    });
    const messageBytes = new TextEncoder().encode(walletBuilt);
    const sig = bs58.encode(nacl.sign.detached(messageBytes, kp.secretKey));
    expect(
      verifySiwsSignatureBytes(messageBytes, sig, kp.walletAddress),
    ).toBe(true);
  });

  it('verifies bytes that include a wallet-added prefix', () => {
    // The SIWS spec explicitly allows wallets to mutate bytes before
    // signing. The server-side bytes path must accept whatever the
    // wallet signed, regardless of canonical-form drift.
    const kp = generateTestKeypair();
    const canonical = buildSiwsMessage({
      wallet: kp.walletAddress,
      nonce: 'siws-prefix',
      action: 'login',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const mutated = `Domain confirmation: vizzor.ai\n${canonical}`;
    const messageBytes = new TextEncoder().encode(mutated);
    const sig = bs58.encode(nacl.sign.detached(messageBytes, kp.secretKey));
    expect(
      verifySiwsSignatureBytes(messageBytes, sig, kp.walletAddress),
    ).toBe(true);
  });

  it('rejects a signature against tampered bytes', () => {
    const kp = generateTestKeypair();
    const canonical = buildSiwsMessage({
      wallet: kp.walletAddress,
      nonce: 'siws-tamper',
      action: 'login',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const bytes = new TextEncoder().encode(canonical);
    const sig = bs58.encode(nacl.sign.detached(bytes, kp.secretKey));
    const tamperedBytes = new TextEncoder().encode(
      canonical.replace(
        'Authenticate this wallet to start your Vizzor session.',
        'Link this wallet to your Vizzor account.',
      ),
    );
    expect(
      verifySiwsSignatureBytes(tamperedBytes, sig, kp.walletAddress),
    ).toBe(false);
  });

  it('rejects truncated or malformed signatures', () => {
    const kp = generateTestKeypair();
    const bytes = new TextEncoder().encode('hello');
    expect(verifySiwsSignatureBytes(bytes, 'not-a-signature', kp.walletAddress)).toBe(false);
    expect(verifySiwsSignatureBytes(bytes, '', kp.walletAddress)).toBe(false);
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
