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
import { paymentNetwork, type PaymentNetwork } from './network';

export const SIWS_DOMAIN = 'vizzor.ai';
export const NONCE_TTL_MS = 5 * 60 * 1000;
export const AUTH_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * CAIP-2 chain identifier per Solana cluster. Phantom (and other
 * SIWS-aware wallets) refuse to sign a message whose `Chain ID:`
 * line doesn't match the network the wallet is currently on — that
 * was the actual cause of the persistent "Unexpected error" on
 * localhost with Phantom in Testnet Mode.
 */
export function siwsChainIdFor(network: PaymentNetwork): string {
  if (network === 'mainnet') return 'solana:mainnet';
  if (network === 'testnet') return 'solana:testnet';
  return 'solana:devnet';
}

/**
 * Domain + URI to use in the SIWS message body. Phantom (and the SIWS
 * standard) requires the `domain` in the message to match the origin
 * the dapp was loaded from — anything else gets treated as potential
 * phishing and rejected.
 *
 * Resolution order:
 *   1. `Origin` header on the incoming request (set by every modern
 *      browser; the `origin-check` middleware has already validated it).
 *   2. `Referer` header as a fallback (rare; some Brave configs strip
 *      Origin on same-origin POSTs).
 *   3. The static `vizzor.ai` baseline so non-browser callers and
 *      tests get a deterministic value.
 *
 * The returned `domain` is the host portion (no scheme); `uri` is
 * the full origin (with scheme) the way the SIWS spec defines.
 */
export function resolveSiwsContext(req: Request): {
  domain: string;
  uri: string;
  chainId: string;
} {
  const headerOrigin =
    req.headers.get('origin') ??
    req.headers.get('referer') ??
    `https://${SIWS_DOMAIN}`;
  let uri = headerOrigin;
  let domain = SIWS_DOMAIN;
  try {
    const u = new URL(headerOrigin);
    uri = u.origin;
    domain = u.host;
  } catch {
    // headerOrigin was already malformed; fall through to defaults.
  }
  return {
    domain,
    uri,
    chainId: siwsChainIdFor(paymentNetwork()),
  };
}

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

/**
 * The SIWS `statement` (the second paragraph of the message body) that
 * gets baked into the bytes the wallet signs. Action enforcement is
 * carried entirely by this string — distinct statements per action so
 * a `login` signature can't replay as `link` and vice versa.
 *
 * IMPORTANT: the statement MUST NOT reference a specific brand domain
 * (e.g. `"Sign in to vizzor.ai"`). Phantom rejects sign requests
 * whose statement claims a different domain than the actual page
 * origin — its phishing protection assumes a dapp at evil.com
 * claiming to be vizzor.ai. On localhost the mismatch is even more
 * stark (origin = `localhost:3000`, statement claimed `vizzor.ai`)
 * and Phantom returns the generic `"Unexpected error"` so attackers
 * can't probe which check failed. Keep these strings
 * domain-agnostic; the domain is already carried by the `domain` and
 * `URI` fields of the SIWS message where the wallet enforces it
 * against the actual origin.
 *
 * Must be kept in sync with the `statement` passed to Wallet Standard
 * `signIn` in `components/wallet/wallet-connect-flow.tsx`.
 */
const ACTION_STATEMENTS: Record<SiwsAction, string> = {
  login: 'Authenticate this wallet to start your Vizzor session.',
  link: 'Link this wallet to your Vizzor account.',
};

export function siwsActionLabel(action: SiwsAction): string {
  return ACTION_LABELS[action];
}

export function siwsStatementFor(action: SiwsAction): string {
  return ACTION_STATEMENTS[action];
}

/**
 * Recover the action from a previously-built SIWS message (used by
 * the verify endpoint to refuse cross-route signature replay). Returns
 * null when the message statement doesn't match a known action.
 */
export function parseSiwsActionFromMessage(message: string): SiwsAction | null {
  if (message.includes(`\n${ACTION_STATEMENTS.login}\n`)) return 'login';
  if (message.includes(`\n${ACTION_STATEMENTS.link}\n`)) return 'link';
  return null;
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
  /**
   * Optional SIWS message context. When omitted, falls back to the
   * static `vizzor.ai` / `solana:mainnet` defaults — keeps existing
   * tests passing without per-test plumbing. Endpoints pass the
   * resolved value from `resolveSiwsContext(req)` so the message body
   * matches the wallet's origin and active network.
   */
  domain?: string;
  uri?: string;
  chainId?: string;
}): string {
  const domain = opts.domain ?? SIWS_DOMAIN;
  const uri = opts.uri ?? `https://${SIWS_DOMAIN}`;
  const chainId = opts.chainId ?? 'solana:mainnet';
  // Action is now baked into the SIWS `statement` line — the previous
  // standalone `Action: Login` line was a non-standard field. Phantom
  // (and any spec-compliant SIWS parser) rejects messages that include
  // fields outside the published set [URI, Version, Chain ID, Nonce,
  // Issued At, Expiration Time, Not Before, Request ID, Resources],
  // returning the generic `"Unexpected error"`. `statement` is a
  // canonical SIWS field, so embedding the action there keeps the
  // scope binding and the SIWS-compliant body. `parseSiwsActionFromMessage`
  // recovers the action server-side.
  return [
    `${domain} wants you to sign in with your Solana account:`,
    opts.wallet,
    '',
    ACTION_STATEMENTS[opts.action],
    '',
    `URI: ${uri}`,
    'Version: 1',
    `Chain ID: ${chainId}`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${opts.issuedAt.toISOString()}`,
    `Expiration Time: ${opts.expiresAt.toISOString()}`,
  ].join('\n');
}

/**
 * Build the canonical SIWS message for the v0.2.0 `link-wallet` action.
 *
 * Differs from `buildSiwsMessage` in exactly two semantic ways:
 *   - The action statement reads "Link Solana wallet to Telegram
 *     account <id>" instead of "Sign in to vizzor.ai", so the wallet
 *     prompt the user sees describes the action they are authorising.
 *   - A `Purpose: Link Telegram Account <id>` line is appended after
 *     `Chain ID:`, binding the signature scope so a `link` signature
 *     cannot be replayed as a `login` signature (and vice versa). The
 *     login route MUST refuse a message that contains the `Purpose:
 *     Link Telegram Account ...` line; the link route MUST refuse a
 *     message that omits it. C4 (crypto-security) owns the negative
 *     tests for these scope boundaries.
 *
 * The Telegram user id is interpolated as a base-10 integer. Callers
 * must pass a positive integer; we throw on anything else because a
 * malformed id would otherwise produce a parseable-but-wrong message
 * that the wallet would happily sign.
 */
export function buildLinkWalletMessage(opts: {
  wallet: string;
  telegramUserId: number;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
  domain?: string;
  uri?: string;
  chainId?: string;
}): string {
  if (
    !Number.isFinite(opts.telegramUserId) ||
    !Number.isInteger(opts.telegramUserId) ||
    opts.telegramUserId <= 0
  ) {
    throw new Error(
      'buildLinkWalletMessage: telegramUserId must be a positive integer',
    );
  }
  const domain = opts.domain ?? SIWS_DOMAIN;
  const uri = opts.uri ?? `https://${SIWS_DOMAIN}`;
  const chainId = opts.chainId ?? 'solana:mainnet';
  return [
    `${domain} wants you to sign in with your Solana account:`,
    opts.wallet,
    '',
    `Link Solana wallet to Telegram account ${opts.telegramUserId}`,
    '',
    `URI: ${uri}`,
    'Version: 1',
    `Chain ID: ${chainId}`,
    `Purpose: Link Telegram Account ${opts.telegramUserId}`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${opts.issuedAt.toISOString()}`,
    `Expiration Time: ${opts.expiresAt.toISOString()}`,
  ].join('\n');
}

/**
 * Parsed view of a SIWS message string. Fields are extracted from a
 * possibly wallet-modified byte stream — Wallet Standard `signIn`
 * implementations are explicitly allowed to prefix or otherwise
 * mutate the message before signing it, so we cannot rebuild the
 * canonical form server-side and byte-compare. Instead we parse the
 * actual signed bytes and assert the security-relevant fields match
 * the cookie-bound expectations (wallet, nonce, action statement).
 */
export interface ParsedSiwsMessage {
  domain: string;
  address: string;
  statement: string | null;
  uri: string | null;
  version: string | null;
  chainId: string | null;
  nonce: string | null;
  issuedAt: string | null;
  expirationTime: string | null;
}

/**
 * Best-effort parser for a SIWS / CAIP-122 message. Returns null when
 * the input doesn't have the required structure (preamble + address +
 * at least the Nonce field). Tolerates extra fields and leading
 * whitespace the wallet may have inserted.
 */
export function parseSiwsMessageString(message: string): ParsedSiwsMessage | null {
  if (typeof message !== 'string' || message.length === 0) return null;
  const lines = message.split(/\r?\n/);
  const preambleIdx = lines.findIndex((l) =>
    /\bwants you to sign in with your Solana account:\s*$/.test(l),
  );
  if (preambleIdx < 0) return null;
  const preamble = lines[preambleIdx] ?? '';
  const domainMatch = preamble.match(/^(\S+)\s+wants you to sign in/);
  const domain = domainMatch?.[1] ?? '';
  const address = (lines[preambleIdx + 1] ?? '').trim();
  if (!domain || !address) return null;

  // Statement (optional): first non-blank line after the address that
  // isn't a `Key: Value` field. Sits between blank-separator lines.
  let statement: string | null = null;
  let cursor = preambleIdx + 2;
  while (cursor < lines.length && (lines[cursor] ?? '').trim() === '') cursor += 1;
  if (cursor < lines.length) {
    const line = lines[cursor] ?? '';
    if (!/^[A-Za-z][A-Za-z ]+:\s/.test(line)) {
      statement = line.trim() || null;
      cursor += 1;
    }
  }

  // Remaining lines: collect `Key: Value` pairs.
  const fields = new Map<string, string>();
  for (let i = cursor; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const m = line.match(/^([A-Za-z][A-Za-z ]+):\s*(.*)$/);
    if (!m) continue;
    fields.set((m[1] ?? '').trim(), (m[2] ?? '').trim());
  }

  const nonce = fields.get('Nonce') ?? null;
  if (!nonce) return null;

  return {
    domain,
    address,
    statement,
    uri: fields.get('URI') ?? null,
    version: fields.get('Version') ?? null,
    chainId: fields.get('Chain ID') ?? null,
    nonce,
    issuedAt: fields.get('Issued At') ?? null,
    expirationTime: fields.get('Expiration Time') ?? null,
  };
}

/**
 * Resolve the `SiwsAction` from a parsed message by matching the
 * statement against the canonical map. Used when verifying bytes the
 * wallet produced via `signIn` — the statement is the only field
 * binding scope, and a server-side mismatch must fail closed.
 */
export function siwsActionFromStatement(
  statement: string | null,
): SiwsAction | null {
  if (!statement) return null;
  const trimmed = statement.trim();
  if (trimmed === ACTION_STATEMENTS.login) return 'login';
  if (trimmed === ACTION_STATEMENTS.link) return 'link';
  return null;
}

/**
 * Verify an ed25519 signature against an explicit `Uint8Array` payload
 * — used when the wallet returned the exact bytes it signed (Wallet
 * Standard `signIn` output). The wallet is allowed to prefix or
 * otherwise modify the message before signing, so verifying against
 * a server-reconstructed string would fail spuriously. Callers MUST
 * still parse the bytes and assert nonce/wallet/scope.
 */
export function verifySiwsSignatureBytes(
  messageBytes: Uint8Array,
  signatureRaw: string,
  wallet: string,
): boolean {
  let signature: Uint8Array;
  try {
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
  try {
    return nacl.sign.detached.verify(messageBytes, signature, publicKey);
  } catch {
    return false;
  }
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
