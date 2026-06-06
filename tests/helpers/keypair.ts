/**
 * Test keypair + SIWS message helpers.
 *
 * Produces ed25519 keypairs via tweetnacl and signs canonical SIWS
 * messages so the verify path can be exercised end-to-end without
 * a real wallet provider. Mirrors the shape lib/payment/siws.ts
 * expects: base58 wallet, base58 signature.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { buildSiwsMessage, type SiwsAction } from '@/lib/payment/siws';

export interface TestKeypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  /** Base58-encoded 32-byte public key (Solana address form). */
  walletAddress: string;
}

export function generateTestKeypair(): TestKeypair {
  const pair = nacl.sign.keyPair();
  return {
    publicKey: pair.publicKey,
    secretKey: pair.secretKey,
    walletAddress: bs58.encode(pair.publicKey),
  };
}

export function signMessage(message: string, secretKey: Uint8Array): string {
  const messageBytes = new TextEncoder().encode(message);
  const sig = nacl.sign.detached(messageBytes, secretKey);
  return bs58.encode(sig);
}

export interface SignedSiws {
  wallet: string;
  signature: string;
  message: string;
  nonce: string;
  action: SiwsAction;
  issuedAt: Date;
  expiresAt: Date;
}

/**
 * Build and sign a canonical SIWS message in one call. Mirrors what
 * a real wallet would do given a /nonce response. Defaults to the
 * 'login' action; pass action explicitly for link-wallet flows.
 */
export function buildSignedSiws(opts: {
  keypair: TestKeypair;
  nonce: string;
  action?: SiwsAction;
  issuedAt?: Date;
  expiresAt?: Date;
}): SignedSiws {
  const action: SiwsAction = opts.action ?? 'login';
  const issuedAt = opts.issuedAt ?? new Date();
  const expiresAt =
    opts.expiresAt ?? new Date(issuedAt.getTime() + 5 * 60 * 1000);
  const message = buildSiwsMessage({
    wallet: opts.keypair.walletAddress,
    nonce: opts.nonce,
    action,
    issuedAt,
    expiresAt,
  });
  const signature = signMessage(message, opts.keypair.secretKey);
  return {
    wallet: opts.keypair.walletAddress,
    signature,
    message,
    nonce: opts.nonce,
    action,
    issuedAt,
    expiresAt,
  };
}
