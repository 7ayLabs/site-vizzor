/**
 * Sign-In With Solana (SIWS) — wallet-based browser auth.
 *
 * Flow:
 *   1. POST /api/auth/siws/nonce   { wallet }     → { nonce, message }
 *      The server generates a random nonce (used once), stores it in
 *      a short-lived cookie, returns the SIWS message the wallet
 *      should sign.
 *   2. Wallet signs with ed25519, returns 64-byte signature.
 *   3. POST /api/auth/siws/verify  { wallet, signature }
 *      Server reads the nonce cookie, recomputes the expected
 *      message, verifies the signature with tweetnacl, and on success
 *      mints an HttpOnly auth session cookie pointing at a row in
 *      `auth_sessions` keyed by the wallet.
 *
 * The auth-session cookie is 24h TTL by default. /predict reads it
 * server-side via getActiveWalletForRequest() and resolves the
 * subscription tier (if any) for the connected wallet.
 *
 * The signature scheme is ed25519. We deliberately avoid pulling
 * @solana/web3.js into the server bundle — bs58 + tweetnacl is enough.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { randomBytes } from 'node:crypto';

export const SIWS_DOMAIN = 'vizzor.ai';
export const NONCE_TTL_MS = 5 * 60 * 1000;
export const AUTH_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Scope of the SIWS signature. `login` produces a session cookie;
 * `link` binds the wallet to a Telegram user via wallet_links. Action
 * is baked into the canonical message bytes, so an ed25519 signature
 * for one action cannot satisfy the other route. See RFC §5.2.
 */
export type SiwsAction = 'login' | 'link';

const ACTION_LABELS: Record<SiwsAction, string> = {
  login: 'Login',
  link: 'Link Wallet',
};

export function siwsActionLabel(action: SiwsAction): string {
  return ACTION_LABELS[action];
}

/**
 * Parse an `action` field from an untrusted source (request body or
 * cookie segment). Returns null on anything not in the enum; callers
 * MUST fail closed on null.
 */
export function parseSiwsAction(raw: unknown): SiwsAction | null {
  return raw === 'login' || raw === 'link' ? raw : null;
}

export function generateNonce(): string {
  // 16 bytes hex = 32 chars, plenty of entropy for nonce purposes.
  return randomBytes(16).toString('hex');
}

export function generateAuthToken(): string {
  // 32 bytes base64-url. Used as the auth-session cookie value.
  return randomBytes(32).toString('base64url');
}

/**
 * Build the canonical SIWS message the wallet signs. Format follows
 * the CAIP-122 / SIWE template adapted for Solana. Domain, nonce, and
 * action are bound; any rewrite invalidates the signature.
 *
 * The `Action:` line is an extension over the CAIP-122 baseline. It
 * defends against cross-route signature replay (login signature
 * replayed against the link route or vice versa) — see RFC §5.2.
 */
export function buildSiwsMessage(opts: {
  wallet: string;
  nonce: string;
  action: SiwsAction;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  return [
    `${SIWS_DOMAIN} wants you to sign in with your Solana account:`,
    opts.wallet,
    '',
    'Sign in to vizzor.ai',
    '',
    `URI: https://${SIWS_DOMAIN}`,
    'Version: 1',
    `Chain ID: solana:mainnet`,
    `Action: ${ACTION_LABELS[opts.action]}`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${opts.issuedAt.toISOString()}`,
    `Expiration Time: ${opts.expiresAt.toISOString()}`,
  ].join('\n');
}

/**
 * Verify an ed25519 signature over a SIWS message. `wallet` is the
 * base58-encoded Solana public key; `signature` is base58 or base64
 * (we try both). Returns true on success.
 */
export function verifySiwsSignature(
  message: string,
  signatureRaw: string,
  wallet: string,
): boolean {
  let signature: Uint8Array;
  try {
    // Try base58 first (standard Solana wallet output)
    signature = bs58.decode(signatureRaw);
  } catch {
    try {
      signature = Uint8Array.from(Buffer.from(signatureRaw, 'base64'));
    } catch {
      return false;
    }
  }
  let publicKey: Uint8Array;
  try {
    publicKey = bs58.decode(wallet);
  } catch {
    return false;
  }
  if (signature.length !== 64 || publicKey.length !== 32) return false;
  const messageBytes = new TextEncoder().encode(message);
  try {
    return nacl.sign.detached.verify(messageBytes, signature, publicKey);
  } catch {
    return false;
  }
}

export function isValidSolanaAddress(s: string): boolean {
  try {
    const decoded = bs58.decode(s);
    return decoded.length === 32;
  } catch {
    return false;
  }
}
