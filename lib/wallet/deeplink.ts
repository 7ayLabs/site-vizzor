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
 *      localStorage (see security note below), then sets
 *      window.location.href to:
 *
 *        https://phantom.com/ul/v1/connect
 *          ?dapp_encryption_public_key=<base58>
 *          &cluster=<mainnet-beta|devnet|testnet>
 *          &app_url=<https://vizzor.ai>
 *          &redirect_link=<https://vizzor.ai/en/wallet/callback?step=connect>
 *
 *      Phantom moved their universal-link host from `phantom.app` to
 *      `phantom.com` in 2025; using the new host directly avoids the
 *      `.app → .com` 301 that breaks iOS Universal Link interception
 *      (Safari ends up stuck on Phantom's marketing page with the
 *      "Opening link…" message instead of opening the app). On
 *      Android we use the equivalent `intent://` form so the Play
 *      Store fallback is preserved even when Phantom isn't installed.
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
 *      `https://phantom.com/ul/v1/signMessage?...&payload=<base58>`.
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
 * Why localStorage (and not sessionStorage): the wallet app's
 * Universal Link redirect back to the dapp commonly lands in a
 * *new* browser tab on iOS (Safari + Brave + Chrome iOS all do
 * this when WKWebView resolves the UL while the original tab is
 * suspended). A new tab carries its own empty `sessionStorage`,
 * which means the dapp secret key needed to decrypt Phantom's
 * encrypted response is gone — the callback then 400s with
 * `handoff_missing` even though the user signed correctly. The
 * security trade-off is acceptable: the X25519 keypair is generated
 * fresh per attempt, narrowly TTL-bounded to 5 minutes (enforced in
 * `loadHandoff`), and discarded immediately after verify. An XSS
 * attacker on the dapp can read either storage anyway, so
 * tab-isolation isn't the real boundary.
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
  /** Epoch ms the handoff was created. `loadHandoff` rejects
   *  anything older than `HANDOFF_TTL_MS` so stale keypairs from
   *  abandoned attempts can't be replayed against a new flow. */
  createdAt?: number;
}

/**
 * How long a handoff state is considered fresh. The round trip
 * through the wallet app is normally well under a minute; the
 * SIWS nonce we couple to it is also 5-minute TTL. Going beyond
 * five minutes means the SIWS nonce is dead anyway, so we drop
 * the handoff state and force a clean restart.
 */
export const HANDOFF_TTL_MS = 5 * 60 * 1000;

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
  // Always stamp the creation time on first save — the TTL gate in
  // `loadHandoff` keys off this. Subsequent `updateHandoff` calls
  // preserve the original `createdAt` so the window doesn't extend.
  const stamped: HandoffState = {
    ...state,
    createdAt: state.createdAt ?? Date.now(),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped));
}

export function loadHandoff(): HandoffState | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  let parsed: HandoffState | null = null;
  try {
    parsed = JSON.parse(raw) as HandoffState;
  } catch {
    // Malformed payload — discard rather than surface to the caller
    // as a partial state that could decrypt against wrong keys.
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  // TTL gate: handoffs older than HANDOFF_TTL_MS are dead and could
  // be replays. The SIWS nonce we coupled to this keypair is also
  // 5-minute TTL, so anything older was unrecoverable anyway.
  if (
    parsed?.createdAt &&
    Date.now() - parsed.createdAt > HANDOFF_TTL_MS
  ) {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  return parsed;
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
  window.localStorage.removeItem(STORAGE_KEY);
}

/* ─────────────────────── URL builders ─────────────────────── */

/**
 * Universal-link base URL per provider. Phantom previously published
 * `phantom.app/ul/v1/...` but consolidated to `phantom.com` in 2025 —
 * the old host now 301s to the new one, and on iOS the redirect chain
 * breaks the Universal Link association so Safari ends up stuck on
 * the marketing page ("Opening link…"). Targeting the new host
 * directly preserves the user gesture and lets iOS / Android open
 * the wallet app.
 */
function baseUrlFor(providerId: DeeplinkProviderId): string {
  switch (providerId) {
    case 'phantom':
      return 'https://phantom.com/ul/v1';
    case 'solflare':
      return 'https://solflare.com/ul/v1';
  }
}

/**
 * Custom-scheme equivalent of the universal link, used as a manual
 * fallback when iOS / Android don't intercept the https deeplink (the
 * "Opening link…" stuck state). Tapping a `phantom://` URL invokes
 * the app's URL handler directly and bypasses the browser's
 * association-resolution dance — but only works when the app is
 * actually installed, so we show it behind the primary UL navigation
 * rather than instead of it.
 */
export function buildFallbackSchemeUrl(
  providerId: DeeplinkProviderId,
  universalUrl: string,
): string {
  // Strip the `https://<host>` prefix so we keep the same path + query
  // string in the custom scheme. Phantom and Solflare both honor the
  // identical path under their custom scheme.
  const stripped = universalUrl.replace(
    /^https:\/\/(phantom\.com|phantom\.app|solflare\.com)/,
    '',
  );
  switch (providerId) {
    case 'phantom':
      return `phantom:${stripped}`;
    case 'solflare':
      return `solflare:${stripped}`;
  }
}

/**
 * Platform discriminator used to pick the right fallback strategy.
 * Android's `intent://` URL is the most reliable invocation; iOS
 * always uses the universal link + a tap-to-open custom-scheme
 * backup. Desktop callers should never reach this path.
 */
export type MobilePlatform = 'ios' | 'android' | 'desktop';

export function detectMobilePlatform(): MobilePlatform {
  if (typeof window === 'undefined') return 'desktop';
  const ua = window.navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

/**
 * Build an Android Intent URL that guarantees the wallet app is
 * launched when installed, with the universal link as the browser
 * fallback when it isn't. Format documented at
 * https://developer.chrome.com/docs/android/intents/.
 *
 * The `package` field uses the published app id Phantom and Solflare
 * register on the Play Store.
 */
export function buildAndroidIntentUrl(
  providerId: DeeplinkProviderId,
  universalUrl: string,
): string {
  const pkg = providerId === 'phantom' ? 'app.phantom' : 'com.solflare.mobile';
  // Strip `https://` so the path travels under the Intent's `scheme=https`.
  const stripped = universalUrl.replace(/^https:\/\//, '');
  const fallback = encodeURIComponent(universalUrl);
  return `intent://${stripped}#Intent;scheme=https;package=${pkg};S.browser_fallback_url=${fallback};end`;
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

export interface MobileConnectKickoff {
  /** Universal-link URL — `https://phantom.com/ul/v1/connect?…`.
   *  Primary navigation target on iOS and the browser-fallback
   *  inside the Android Intent. */
  universalUrl: string;
  /** Android Intent URL — guaranteed wallet-app invocation when the
   *  app is installed; falls through to `universalUrl` when not. */
  androidIntentUrl: string;
  /** Custom-scheme URL — `phantom:/ul/v1/connect?…` — used as the
   *  user-tappable "Open in Phantom" fallback when the iOS
   *  Universal Link doesn't intercept and Safari gets stuck on the
   *  wallet website's bridge page. */
  fallbackSchemeUrl: string;
  /** Active platform — drives which URL the caller navigates to
   *  first. */
  platform: MobilePlatform;
}

/**
 * Top-level entry from `WalletConnectFlow`'s mobile branch. Generates
 * a fresh keypair, persists the handoff state, and returns every URL
 * the caller might need:
 *
 *   - `universalUrl`         → primary on iOS
 *   - `androidIntentUrl`     → primary on Android
 *   - `fallbackSchemeUrl`    → user-tappable backup on either
 *
 * Caller should `window.location.href = androidIntentUrl` on Android
 * and `window.location.href = universalUrl` on iOS; if the user is
 * still on the page after ~2s the UI should reveal a "Open in
 * Phantom" button bound to `fallbackSchemeUrl`.
 */
/**
 * Pre-allocated server-side handoff state. The dapp generates the
 * X25519 keypair, POSTs it to `/api/auth/mobile-handoff`, and stores
 * the returned `hid` token. The callback page redeems the `hid`
 * server-side instead of relying on browser storage — bypasses iOS
 * Brave / Safari's habit of dropping per-origin storage when the
 * wallet's universal link is resumed in a fresh WKWebView process.
 */
export interface ServerHandoff {
  hid: string;
  dappPublicKey: string;
  dappSecretKey: string;
}

/**
 * Generate a keypair, POST it to the server, and return the hid +
 * keypair the caller will plug into `startMobileConnect`. The fetch
 * is async — callers should pre-allocate while the modal opens so
 * the user-tap handler can stay synchronous (iOS Universal Link
 * interception requires the navigation to happen inside the gesture
 * window).
 *
 * Throws on network / server failure — caller falls back to the
 * localStorage path inside `startMobileConnect`.
 */
export async function preallocateServerHandoff(opts: {
  providerId: DeeplinkProviderId;
  returnTo: string;
}): Promise<ServerHandoff> {
  const kp = generateDappKeypair();
  const dappPublicKey = bs58.encode(kp.publicKey);
  const dappSecretKey = bs58.encode(kp.secretKey);
  const res = await fetch('/api/auth/mobile-handoff', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      state: {
        providerId: opts.providerId,
        dappPublicKey,
        dappSecretKey,
        returnTo: opts.returnTo,
        createdAt: Date.now(),
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`preallocate_failed:${res.status}`);
  }
  const data = (await res.json()) as { ok?: boolean; hid?: string };
  if (!data.ok || !data.hid) {
    throw new Error('preallocate_response_missing_hid');
  }
  return { hid: data.hid, dappPublicKey, dappSecretKey };
}

/**
 * Append `&hid=<hid>` to the callback URL so the wallet's redirect
 * arrives at the dapp carrying the server-side handoff token along
 * with the wallet's encrypted response params. Caller-side helper so
 * the URL composition stays in one place.
 */
function appendHidToCallback(callbackUrl: string, hid: string): string {
  return callbackUrl.includes('?')
    ? `${callbackUrl}&hid=${hid}`
    : `${callbackUrl}?hid=${hid}`;
}

export function startMobileConnect(opts: {
  providerId: DeeplinkProviderId;
  returnTo: string;
  /** Where Phantom should redirect back to. */
  callbackUrl: string;
  /** Pre-allocated server-side handoff. When provided we use its
   *  keypair + hid; the redirect URL gets `&hid=<hid>` so the
   *  callback can redeem it. When omitted, we fall back to the
   *  legacy localStorage path (kept for graceful degradation when
   *  the pre-allocation network call hasn't returned yet). */
  serverHandoff?: ServerHandoff;
}): MobileConnectKickoff {
  let dappPublicKey: string;
  let dappSecretKey: string;
  let callbackUrl = opts.callbackUrl;

  if (opts.serverHandoff) {
    dappPublicKey = opts.serverHandoff.dappPublicKey;
    dappSecretKey = opts.serverHandoff.dappSecretKey;
    callbackUrl = appendHidToCallback(callbackUrl, opts.serverHandoff.hid);
  } else {
    const kp = generateDappKeypair();
    dappPublicKey = bs58.encode(kp.publicKey);
    dappSecretKey = bs58.encode(kp.secretKey);
  }

  // Always persist to localStorage too — costs nothing and gives the
  // callback page a fallback if the server-side hid lookup fails.
  saveHandoff({
    providerId: opts.providerId,
    dappPublicKey,
    dappSecretKey,
    returnTo: opts.returnTo,
  });

  const universalUrl = buildConnectUrl({
    providerId: opts.providerId,
    dappPublicKey,
    redirectLink: callbackUrl,
  });
  return {
    universalUrl,
    androidIntentUrl: buildAndroidIntentUrl(opts.providerId, universalUrl),
    fallbackSchemeUrl: buildFallbackSchemeUrl(opts.providerId, universalUrl),
    platform: detectMobilePlatform(),
  };
}
