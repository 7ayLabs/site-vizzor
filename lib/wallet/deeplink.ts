/**
 * Mobile wallet bridge — Phantom / Solflare Connect Protocol.
 *
 * Replaces the older "open the dapp inside the wallet's in-app browser"
 * (`phantom://browse/<url>`) handoff. The Connect Protocol keeps the user
 * in their normal mobile browser (Safari / Chrome / Brave) the whole
 * time; the wallet app only opens briefly to approve the connection
 * and again to sign the SIWS message, then redirects back via a
 * universal link.
 *
 * Round-trip (Phantom; Solflare is identical with different base URLs):
 *
 *   1. Site generates an ephemeral X25519 keypair, persists it to
 *      sessionStorage, then sets window.location.href to:
 *
 *        https://phantom.app/ul/v1/connect
 *          ?dapp_encryption_public_key=<base58>
 *          &cluster=<mainnet-beta|devnet|testnet>
 *          &app_url=<https://vizzor.ai>
 *          &redirect_link=<https://vizzor.ai/en/wallet/callback?step=connect>
 *
 *   2. iOS / Android dispatches to the wallet app; user approves;
 *      Phantom redirects back to the redirect_link with:
 *
 *        ...?phantom_encryption_public_key=<base58>&nonce=<base58>&data=<base58>
 *
 *      (Or `errorCode` / `errorMessage` on rejection / failure.)
 *
 *   3. Site decrypts `data` with `nacl.box.open.after` using the shared
 *      secret derived from `phantom_encryption_public_key` × dapp secret
 *      key. The plaintext is `{ public_key, session }`.
 *
 *   4. Site fetches the SIWS nonce (`/api/auth/siws/nonce`), encrypts
 *      `{ session, message }` under the shared secret, and navigates to
 *      `https://phantom.app/ul/v1/signMessage?...&payload=<base58>`.
 *
 *   5. User signs; Phantom redirects back; site decrypts the signature,
 *      POSTs to `/api/auth/siws/verify`, then hops back to `returnTo`.
 *
 * Why X25519 + NaCl box: this is what Phantom and Solflare both
 * publish; tweetnacl is already in deps for the SIWS path so we don't
 * add a crypto dependency. Base58 encoding via bs58 (also already in
 * deps) matches Solana's address encoding so callers can treat
 * `walletAddress` as a regular pubkey string.
 *
 * Why sessionStorage and not localStorage: the keypair is sensitive
 * to this tab + this attempt. Closing the tab discards the secret.
 * Other tabs can't pick up a partial handoff. After verify succeeds
 * we clear it; if the user abandons the flow it dies on tab close.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { paymentNetwork } from '@/lib/payment/network';

const MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
const WALLET_BROWSER_UA = /Phantom|Solflare|Backpack|Glow|TrustWallet/i;

const STORAGE_KEY = 'vizzor.wallet.handoff';

/* ─────────────────────── public types ─────────────────────── */

export type DeeplinkProviderId = 'phantom' | 'solflare';

export type DeeplinkStep = 'connect' | 'sign';

export interface HandoffState {
  providerId: DeeplinkProviderId;
  /** base58-encoded X25519 public key for this attempt. */
  dappPublicKey: string;
  /** base58-encoded X25519 secret key for this attempt. */
  dappSecretKey: string;
  /** base58-encoded shared secret with the wallet, filled in after connect. */
  sharedSecret?: string;
  /** Wallet pubkey (base58), filled in after connect. */
  walletAddress?: string;
  /** Wallet session token, required on every subsequent deeplink. */
  walletSessionToken?: string;
  /** Canonical SIWS message returned by /api/auth/siws/nonce. */
  siwsMessage?: string;
  siwsIssuedAt?: string;
  siwsExpiresAt?: string;
  /** Where to send the user once verify succeeds. */
  returnTo: string;
}

/* ─────────────────────── environment ─────────────────────── */

/**
 * True when running in a regular mobile browser. Excludes wallet
 * in-app browsers (Phantom, Solflare, ...) because those inject a
 * Wallet Standard provider and the desktop flow works as-is.
 */
export function isMobileWeb(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  return MOBILE_UA.test(ua) && !WALLET_BROWSER_UA.test(ua);
}

/**
 * Maps our internal payment network to Phantom / Solflare's
 * `cluster` deeplink parameter. The wallets accept `mainnet-beta`
 * (not `mainnet`) and the literal `testnet` / `devnet` strings.
 */
export function deeplinkCluster(): 'mainnet-beta' | 'testnet' | 'devnet' {
  const n = paymentNetwork();
  if (n === 'mainnet') return 'mainnet-beta';
  if (n === 'testnet') return 'testnet';
  return 'devnet';
}

/* ─────────────────────── crypto primitives ─────────────────────── */

export function generateDappKeypair(): {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
} {
  const kp = nacl.box.keyPair();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

function deriveSharedSecret(
  theirPublicKey: Uint8Array,
  mySecretKey: Uint8Array,
): Uint8Array {
  return nacl.box.before(theirPublicKey, mySecretKey);
}

/* ─────────────────────── handoff state ─────────────────────── */

export function saveHandoff(state: HandoffState): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadHandoff(): HandoffState | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HandoffState;
  } catch {
    return null;
  }
}

export function updateHandoff(
  patch: Partial<HandoffState>,
): HandoffState | null {
  const current = loadHandoff();
  if (!current) return null;
  const next = { ...current, ...patch };
  saveHandoff(next);
  return next;
}

export function clearHandoff(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(STORAGE_KEY);
}

/* ─────────────────────── URL builders ─────────────────────── */

function baseUrlFor(providerId: DeeplinkProviderId): string {
  switch (providerId) {
    case 'phantom':
      return 'https://phantom.app/ul/v1';
    case 'solflare':
      return 'https://solflare.com/ul/v1';
  }
}

export interface BuildConnectUrlOpts {
  providerId: DeeplinkProviderId;
  /** base58-encoded dapp X25519 public key. */
  dappPublicKey: string;
  /** Fully qualified HTTPS URL the wallet should redirect back to. */
  redirectLink: string;
  /** Defaults to the current payment network's cluster. */
  cluster?: 'mainnet-beta' | 'testnet' | 'devnet';
  /** Defaults to the current origin. */
  appUrl?: string;
}

export function buildConnectUrl(opts: BuildConnectUrlOpts): string {
  const cluster = opts.cluster ?? deeplinkCluster();
  const appUrl =
    opts.appUrl ??
    (typeof window === 'undefined' ? 'https://vizzor.ai' : window.location.origin);
  const params = new URLSearchParams({
    dapp_encryption_public_key: opts.dappPublicKey,
    cluster,
    app_url: appUrl,
    redirect_link: opts.redirectLink,
  });
  return `${baseUrlFor(opts.providerId)}/connect?${params.toString()}`;
}

export interface BuildSignMessageUrlOpts {
  providerId: DeeplinkProviderId;
  dappPublicKey: string;
  /** base58 nonce returned alongside `payload`. */
  nonce: string;
  /** base58 ciphertext of `{session, message, display}`. */
  payload: string;
  redirectLink: string;
}

export function buildSignMessageUrl(opts: BuildSignMessageUrlOpts): string {
  const params = new URLSearchParams({
    dapp_encryption_public_key: opts.dappPublicKey,
    nonce: opts.nonce,
    redirect_link: opts.redirectLink,
    payload: opts.payload,
  });
  return `${baseUrlFor(opts.providerId)}/signMessage?${params.toString()}`;
}

/* ─────────────────────── connect-callback decoding ─────────────────────── */

export interface ConnectCallback {
  /** Base58 Solana address. */
  walletAddress: string;
  /** Opaque session token to forward on subsequent deeplinks. */
  sessionToken: string;
  /** Base58 32-byte shared secret derived against the dapp secret. */
  sharedSecret: string;
}

/**
 * Decrypts Phantom/Solflare's `data` response from the connect
 * callback. Throws on any failure — callers convert into the modal's
 * error UI rather than threading a Result type up.
 */
export function decryptConnectCallback(opts: {
  /** Raw query params from the callback URL. */
  phantomPublicKey: string;
  nonce: string;
  data: string;
  /** base58-encoded secret key from the original handoff state. */
  dappSecretKey: string;
}): ConnectCallback {
  const theirPub = bs58.decode(opts.phantomPublicKey);
  const nonce = bs58.decode(opts.nonce);
  const ciphertext = bs58.decode(opts.data);
  const mySecret = bs58.decode(opts.dappSecretKey);

  const shared = deriveSharedSecret(theirPub, mySecret);
  const plaintext = nacl.box.open.after(ciphertext, nonce, shared);
  if (!plaintext) {
    throw new Error('decrypt_failed');
  }
  const json = new TextDecoder().decode(plaintext);
  const payload = JSON.parse(json) as { public_key?: string; session?: string };
  if (!payload.public_key || !payload.session) {
    throw new Error('connect_payload_missing_fields');
  }
  return {
    walletAddress: payload.public_key,
    sessionToken: payload.session,
    sharedSecret: bs58.encode(shared),
  };
}

/* ─────────────────────── signMessage round trip ─────────────────────── */

export interface SignMessageEncoded {
  /** base58 nonce to put on the URL. */
  nonce: string;
  /** base58 payload to put on the URL. */
  payload: string;
}

/**
 * Encrypts `{session, message, display:'utf8'}` for the signMessage
 * deeplink. `message` is the SIWS string the server returned.
 */
export function encodeSignMessagePayload(opts: {
  sharedSecret: string;
  sessionToken: string;
  message: string;
}): SignMessageEncoded {
  const shared = bs58.decode(opts.sharedSecret);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const plain = new TextEncoder().encode(
    JSON.stringify({
      session: opts.sessionToken,
      message: bs58.encode(new TextEncoder().encode(opts.message)),
      display: 'utf8',
    }),
  );
  const ciphertext = nacl.box.after(plain, nonce, shared);
  return {
    nonce: bs58.encode(nonce),
    payload: bs58.encode(ciphertext),
  };
}

/**
 * Decrypts the signMessage callback. Returns the base58 signature
 * (which is what SIWS verify expects on the wire).
 */
export function decryptSignMessageCallback(opts: {
  sharedSecret: string;
  nonce: string;
  data: string;
}): { signature: string } {
  const shared = bs58.decode(opts.sharedSecret);
  const nonce = bs58.decode(opts.nonce);
  const ciphertext = bs58.decode(opts.data);
  const plaintext = nacl.box.open.after(ciphertext, nonce, shared);
  if (!plaintext) {
    throw new Error('decrypt_failed');
  }
  const json = new TextDecoder().decode(plaintext);
  const payload = JSON.parse(json) as { signature?: string };
  if (!payload.signature) {
    throw new Error('signature_missing');
  }
  return { signature: payload.signature };
}

/* ─────────────────────── high-level kickoff ─────────────────────── */

/**
 * Top-level entry from `WalletConnectFlow`'s mobile branch. Generates
 * a fresh keypair, persists the handoff state, and returns the URL
 * to navigate to. Caller does `window.location.href = url`.
 */
export function startMobileConnect(opts: {
  providerId: DeeplinkProviderId;
  returnTo: string;
  /** Where Phantom should redirect back to. */
  callbackUrl: string;
}): string {
  const kp = generateDappKeypair();
  const dappPublicKey = bs58.encode(kp.publicKey);
  const dappSecretKey = bs58.encode(kp.secretKey);
  saveHandoff({
    providerId: opts.providerId,
    dappPublicKey,
    dappSecretKey,
    returnTo: opts.returnTo,
  });
  return buildConnectUrl({
    providerId: opts.providerId,
    dappPublicKey,
    redirectLink: opts.callbackUrl,
  });
}
