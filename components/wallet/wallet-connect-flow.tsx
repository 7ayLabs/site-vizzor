'use client';

/**
 * WalletConnectFlow — in-place Solana wallet connect + SIWS sign.
 *
 * Mounted by `<WalletSelectorModal>` once the user has picked a Solana
 * wallet. Renders nothing visually; it's a side-effect component that
 * drives the wallet adapter through the full handshake and reports
 * status + errors back to the modal via callbacks.
 *
 * Lifecycle:
 *   1. select(name)                — open the wallet's approval popup.
 *   2. wait for `connected`         — adapter has a publicKey + sign fn.
 *   3. POST /api/auth/siws/nonce    — get the canonical SIWS message.
 *   4. signMessage(message)         — open the wallet's sign popup.
 *   5. POST /api/auth/siws/verify   — server validates, mints session.
 *   6. onStatus('success')          — modal closes, navbar updates.
 *
 * Failure handling:
 *   - Wallet not registered (Wallet Standard): open install page in
 *     a new tab, report `wallet_not_installed`.
 *   - User rejects connect / sign: report `user_rejected`, disconnect
 *     to clear any partial state.
 *   - Server fails verify: report `verify_failed` with the reason.
 *
 * Wallet identity goes through Wallet Standard, NOT `window.solana`
 * sniffing — see `wallet-provider.tsx` for the rationale. Brave Wallet
 * registers as `'Brave Wallet'` and never matches `'Phantom'` here.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useLocale } from 'next-intl';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import {
  WalletReadyState,
  type WalletName,
} from '@solana/wallet-adapter-base';
import {
  isMobileWeb,
  startMobileConnect,
  type DeeplinkProviderId,
} from '@/lib/wallet/deeplink';
import { localizedAbsoluteUrl } from '@/lib/wallet/locale-url';

export type SolanaProviderId = 'phantom' | 'solflare' | 'more';

export type ConnectErrorCode =
  | 'wallet_not_installed'
  | 'user_rejected'
  | 'stale_session'
  | 'nonce_failed'
  | 'verify_failed'
  | 'wrong_chain'
  | 'unknown';

/**
 * Maps a raw wallet-adapter throw into one of our user-facing error
 * codes. We prefer the most actionable code: `stale_session` for the
 * generic `WalletConnectionError: Unexpected error` (because the
 * recovery action — revoke trust in Phantom or clear local data — is
 * different from a real user rejection), and `user_rejected` for the
 * common case where the user closed the popup.
 */
/**
 * One link in a walked error chain. Used for both console diagnostics
 * and the dev-only modal cause line.
 */
interface ErrorChainLink {
  name: string;
  message: string;
}

/**
 * Walk an Error's `cause` / `error` chain and flatten it into an
 * array. Phantom and the wallet-standard adapter both nest the
 * underlying failure inside `WalletSignInError(error?.message, error)`,
 * so the message we surface to the user (e.g. `"Unexpected error"`)
 * is often the WRAPPER, not the cause. Walking gives us the inner
 * line we actually want.
 */
function walkErrorChain(err: unknown, depth = 0): ErrorChainLink[] {
  if (depth > 6 || !err || typeof err !== 'object') return [];
  const e = err as { name?: unknown; message?: unknown; cause?: unknown; error?: unknown };
  const link: ErrorChainLink = {
    name: typeof e.name === 'string' ? e.name : 'Error',
    message: typeof e.message === 'string' ? e.message : '',
  };
  const next = e.cause ?? e.error;
  return [link, ...walkErrorChain(next, depth + 1)];
}

/**
 * Render a walked chain as `<top>: <msg> ← <inner>: <msg> ← ...`
 * for the dev-only modal line and detail-string round trips.
 */
function formatCauseChain(chain: readonly ErrorChainLink[]): string {
  return chain
    .map((l) => `${l.name}: ${l.message}`.trim())
    .filter((s) => s.length > 0)
    .join(' ← ');
}

function classifyConnectError(err: Error & { name?: string }): ConnectErrorCode {
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('user rejected') || msg.includes('rejected') || msg.includes('denied')) {
    return 'user_rejected';
  }
  // The wallet-adapter ships this exact string for the generic
  // failure that almost always means "session is in a bad state".
  if (msg.includes('unexpected error')) {
    return 'stale_session';
  }
  if (err.name === 'WalletNotReadyError') return 'wallet_not_installed';
  return 'unknown';
}

export type ConnectStatus =
  | 'connecting'
  | 'signing'
  | 'success';

const WALLET_NAMES: Record<SolanaProviderId, string | null> = {
  phantom: 'Phantom',
  solflare: 'Solflare',
  more: null,
};

// How long to wait for Wallet Standard discovery to surface the
// requested wallet before declaring it not installed.
//
// Discovery usually fires within a single frame of mount, but two
// browser conditions need a longer window:
//   1. Brave actively suppresses other wallets' synchronous global
//      injections to stop them from clobbering its own provider, then
//      releases them on a late tick. With 1.5s Phantom often hadn't
//      registered yet and the modal fell straight through to the
//      download URL — exactly the bug a user reported on Brave.
//   2. Some extensions register late after window.load (cold cache,
//      service-worker spin-up).
// Bumped to 6s (was 3s) because subsequent same-tab attempts also
// race against Wallet Standard re-registration after a disconnect —
// Phantom briefly drops off the registry between attempts and 3s
// wasn't always enough. 6s is still well under any user's patience
// threshold when the wallet really isn't installed.
const READY_TIMEOUT_MS = 6000;

const INSTALL_URLS: Record<SolanaProviderId, string | null> = {
  phantom: 'https://phantom.app/download',
  solflare: 'https://solflare.com/download',
  more: null,
};

export interface WalletConnectFlowProps {
  providerId: SolanaProviderId;
  onStatus: (status: ConnectStatus) => void;
  onError: (code: ConnectErrorCode, detail?: string) => void;
}

export function WalletConnectFlow({
  providerId,
  onStatus,
  onError,
}: WalletConnectFlowProps) {
  const {
    wallets,
    wallet,
    select,
    connect,
    connected,
    publicKey,
    signMessage,
    signIn,
    disconnect,
  } = useWallet();
  // The `wallet` field is reactive — re-running step 3 needs the
  // identity to be stable enough that the effect's dep array fires
  // only on real changes. Already part of `useWallet()` return.
  const { setVisible } = useWalletModal();
  const locale = useLocale();
  const startedRef = useRef(false);
  const connectingRef = useRef(false);
  const signingRef = useRef(false);

  const fail = useCallback(
    async (code: ConnectErrorCode, detail?: string) => {
      onError(code, detail);
      try {
        await disconnect();
      } catch {
        // ignored — we're already in an error path
      }
    },
    [disconnect, onError],
  );

  // Mobile handoff helper — Phantom / Solflare Connect Protocol.
  //
  // On regular mobile browsers (iOS Safari / Chrome / Brave, Android
  // Chrome / Firefox) there is no extension, so `select()` would
  // never resolve via Wallet Standard. Instead we kick off the
  // wallet's `ul/v1/connect` deeplink — the wallet app opens, the
  // user approves, and the wallet returns to `/wallet/callback`
  // with an encrypted response. The callback page finishes the
  // SIWS dance and sends the user back to the page they started on.
  //
  // Critical: the user stays in their main mobile browser the whole
  // time. The wallet app only opens briefly for the connect prompt
  // and again for the signMessage prompt — it never hosts our site
  // in its in-app browser.
  //
  // Returns true if we kicked off a handoff (the modal's outer
  // timeout path then stops itself; navigation has already taken
  // over).
  const tryMobileHandoff = useCallback(
    (id: SolanaProviderId): boolean => {
      if (id === 'more' || !isMobileWeb()) return false;
      if (id !== 'phantom' && id !== 'solflare') return false;
      const deeplinkProvider: DeeplinkProviderId = id;
      const callbackUrl = localizedAbsoluteUrl(
        '/wallet/callback?step=connect',
        locale,
      );
      const kickoff = startMobileConnect({
        providerId: deeplinkProvider,
        returnTo: window.location.href,
        callbackUrl,
      });
      // Stash the user-tappable backup URL so the modal can surface a
      // "Open in Phantom" affordance if the user returns to the page
      // without having reached the wallet app (e.g. iOS got stuck on
      // the wallet's bridge page).
      try {
        window.localStorage.setItem(
          'vizzor.wallet.fallback',
          kickoff.fallbackSchemeUrl,
        );
      } catch {
        // localStorage can be unavailable in private modes — best-effort.
      }
      // Android: prefer the Intent URL — guaranteed app launch when
      // installed, automatic Play-Store fallback when not.
      // iOS / unknown: universal link. The redirect chain to
      // `phantom.com` is now eliminated at the source URL, so Safari's
      // Universal Link interception fires cleanly.
      const target =
        kickoff.platform === 'android'
          ? kickoff.androidIntentUrl
          : kickoff.universalUrl;
      window.location.href = target;
      return true;
    },
    [locale],
  );

  // Step 1 — select the requested wallet.
  //
  // Both legacy direct-injection adapters and Wallet Standard
  // discovery feed `useWallet().wallets`. The legacy entries appear
  // synchronously on mount; Wallet Standard ones arrive as the
  // browser's `wallet-standard:app-ready` events fan in. We re-run
  // this effect on every `wallets`/`readyState` change until either:
  //   (a) the requested wallet's `readyState` is `Installed`/`Loadable`
  //       → select() it, and the user's wallet popup appears.
  //   (b) the requested wallet exists by name but its readyState is
  //       `NotDetected` → it's a registered adapter with no live
  //       injection (extension not running) → open the install link.
  //   (c) after `READY_TIMEOUT_MS` of waiting no entry by that name
  //       has surfaced at all → treat as not installed.
  useEffect(() => {
    if (startedRef.current) return;

    // "more" overflow: hand off immediately to the upstream modal.
    if (providerId === 'more') {
      startedRef.current = true;
      onStatus('connecting');
      setVisible(true);
      return;
    }

    const targetName = WALLET_NAMES[providerId];
    if (!targetName) return;

    const candidate = wallets.find((w) => w.adapter.name === targetName);

    if (candidate) {
      const state = candidate.adapter.readyState;
      if (
        state === WalletReadyState.Installed ||
        state === WalletReadyState.Loadable
      ) {
        startedRef.current = true;
        onStatus('connecting');
        void (async () => {
          try {
            // If we're already holding a stale connection from a prior
            // attempt (same page, no reload), the adapter's `connected`
            // state is true and Step 2's `connect()` would short-circuit
            // — Phantom's popup would never re-pop. Disconnect first so
            // the next `connect()` is a fresh handshake the extension
            // actually surfaces.
            if (connected) {
              try {
                await disconnect();
              } catch {
                // ignored — even if disconnect fails, we still want to
                // try select+connect with whatever state the adapter
                // reports.
              }
            }
            // Just select — Step 2 below handles the actual `connect()`
            // call once `wallet` settles in the context. We intentionally
            // do NOT rely on the provider's autoConnect here because it
            // issues a `{ silent: true }` connect that can throw
            // `WalletConnectionError: Unexpected error` for untrusted
            // wallets (every first-time visitor).
            select(candidate.adapter.name as WalletName);
          } catch (e) {
            void fail('user_rejected', (e as Error).message);
          }
        })();
        return;
      }
      if (state === WalletReadyState.NotDetected) {
        // NotDetected on a subsequent attempt in the same tab is almost
        // always Wallet Standard discovery being slow — Phantom briefly
        // unregisters between attempts. Don't redirect to the install
        // page yet; let the timeout below run and re-evaluate. Only the
        // explicit timeout path opens the install URL.
        return;
      }
      // state === Unsupported (e.g. SSR / non-browser env) — fall
      // through and let the timeout below resolve it.
    }

    // Wallet hasn't surfaced yet. Schedule a one-shot timeout that
    // gives Wallet Standard discovery a chance to fire before we
    // declare the wallet missing. The effect's dependency on `wallets`
    // also re-runs us if discovery completes before the timer.
    const timer = window.setTimeout(() => {
      if (startedRef.current) return;
      startedRef.current = true;
      // Mobile path takes priority — if the user is on iOS/Android
      // there is no extension to wait for, so the timeout is the
      // canonical moment to hand off to the wallet's universal link.
      if (tryMobileHandoff(providerId)) return;
      const url = INSTALL_URLS[providerId];
      if (url && typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      void fail('wallet_not_installed', targetName);
    }, READY_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [providerId, wallets, select, setVisible, onStatus, fail, tryMobileHandoff, connected, disconnect]);

  // Step 2 — once `select()` has settled and `wallet` is non-null,
  // call `connect()` explicitly. The provider's `autoConnect` is OFF
  // on this ephemeral adapter so the connect path is fully under our
  // control. `connect()` throws `WalletNotReadyError` /
  // `WalletConnectionError` / etc. which we translate to a
  // `user_rejected` failure (the most common cause is the user
  // closing the wallet popup).
  useEffect(() => {
    if (connectingRef.current) return;
    if (!wallet || connected) return;
    // Skip until the wallet entry's adapter is actually ready.
    const state = wallet.adapter.readyState;
    if (
      state !== WalletReadyState.Installed &&
      state !== WalletReadyState.Loadable
    ) {
      return;
    }
    connectingRef.current = true;
    // Watchdog: when Phantom is in a state where it silently auto-
    // connects (or silently fails to respond — e.g. Testnet Mode
    // mismatch, locked vault, popup blocked behind the extension
    // panel), `connect()` can hang indefinitely while the user
    // stares at "Open Phantom to approve · Waiting…". Surface a
    // dedicated `stale_session` error after 30s so they can act.
    const watchdog = window.setTimeout(() => {
      if (signingRef.current) return;
      // Last-chance grace: if the adapter has actually connected
      // but `connected` from useWallet hasn't synced yet, give it
      // one more render before failing. The Step 3 effect picks
      // this up naturally.
      if (wallet.adapter.connected && wallet.adapter.publicKey) return;
      void fail('stale_session', 'connect_timeout');
    }, 30_000);

    void (async () => {
      try {
        await connect();
        // Happy path: adapter emitted 'connect', useWallet will sync,
        // Step 3 fires. Cancel the watchdog.
        window.clearTimeout(watchdog);
      } catch (e) {
        window.clearTimeout(watchdog);
        const err = e as Error & { error?: unknown; name?: string };
        // Wallet Standard race: connect() rejected but the underlying
        // adapter actually completed the handshake. Authoritative
        // truth is the adapter's own `connected` + `publicKey`. Keep
        // connectingRef true so this effect doesn't re-fire and pop
        // Phantom a second time; Step 3 takes over once useWallet
        // syncs.
        const adapter = wallet?.adapter;
        if (adapter?.connected && adapter?.publicKey) {
          return;
        }
        if (typeof console !== 'undefined') {
          console.warn(
            '[vizzor] wallet connect rejected',
            { name: err.name, message: err.message, cause: err.error },
          );
        }
        const code = classifyConnectError(err);
        await fail(code, err.message || 'connect_failed');
        connectingRef.current = false;
      }
    })();

    return () => window.clearTimeout(watchdog);
  }, [wallet, connected, connect, fail]);

  // Step 3 — once the wallet is connected, run the SIWS dance. Same
  // happy path as components/auth/wallet-auth-button.tsx but driven
  // here from inside the modal so the user never leaves their page.
  //
  // We prefer Wallet Standard `signIn` (the canonical SIWS feature
  // every modern Solana wallet ships) over the legacy `signMessage`.
  // The spec lets the wallet prefix/modify the message before signing
  // — so even with a byte-perfect canonical SIWS body, `signMessage`
  // could be silently mutated by the wallet and our server-side
  // reconstruction would no longer verify. `signIn` returns the exact
  // bytes the wallet endorsed; the server verifies against those
  // bytes and parses out the security-relevant fields (nonce, wallet,
  // statement) instead of trusting a reconstruction. This is the
  // route Phantom optimizes internally — and the missing piece behind
  // the persistent "Unexpected error" failure on `signMessage`.
  useEffect(() => {
    if (signingRef.current) return;
    if (!connected || !publicKey) return;
    // Either primitive is enough — we'll pick the best one available.
    if (!signIn && !signMessage) return;
    signingRef.current = true;

    void (async () => {
      onStatus('signing');
      const walletAddr = publicKey.toBase58();
      try {
        const nonceRes = await fetch('/api/auth/siws/nonce', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ wallet: walletAddr, action: 'login' }),
        });
        const nonceData = (await nonceRes.json()) as {
          ok: boolean;
          message?: string;
          nonce?: string;
          chainId?: string;
          domain?: string;
          uri?: string;
          issuedAt?: string;
          expiresAt?: string;
          reason?: string;
        };
        if (!nonceData.ok || !nonceData.message || !nonceData.nonce) {
          await fail('nonce_failed', nonceData.reason);
          return;
        }

        // Pre-flight: verify the active Wallet Standard account claims
        // the chain we're about to ask it to sign on. Without this we
        // silently hand Phantom a chain mismatch and get back the
        // generic `"Unexpected error"` with no actionable signal.
        // The chain enum is exposed via the StandardWalletAdapter's
        // public `wallet` getter; legacy direct-injection adapters
        // omit it, in which case we trust the wallet (no false-positives).
        const expectedChain = nonceData.chainId;
        if (expectedChain && wallet?.adapter) {
          const standardWallet = (
            wallet.adapter as unknown as {
              wallet?: { accounts?: ReadonlyArray<{ chains?: readonly string[] }> };
            }
          ).wallet;
          const declaredChains = standardWallet?.accounts?.[0]?.chains;
          if (
            declaredChains &&
            declaredChains.length > 0 &&
            !declaredChains.includes(expectedChain)
          ) {
            await fail('wrong_chain', expectedChain);
            return;
          }
        }

        let signedMessageB64: string | null = null;
        let sigB58: string | null = null;

        // SIWS sign cascade:
        //   1. `signIn` — the Wallet Standard SIWS primitive every
        //      modern Solana wallet ships. Phantom (and others)
        //      optimize this path internally and accept it cleanly on
        //      mainnet / production dapps. This is the right default.
        //   2. `signMessage` — fallback for the narrow case where
        //      `signIn` returns Phantom's generic "Unexpected error"
        //      (its catch-all for an internal validation failure, e.g.
        //      multi-chain Testnet Mode on localhost+Devnet). Phantom
        //      treats arbitrary `signMessage` bytes as opaque, so the
        //      same canonical SIWS body succeeds when the SIWS-aware
        //      path doesn't.
        //
        // User rejections re-throw immediately — we never re-prompt
        // after an explicit user decline.
        const isUserRejection = (err: unknown): boolean => {
          const msg = ((err as Error)?.message || '').toLowerCase();
          return (
            msg.includes('user rejected') ||
            msg.includes('user denied') ||
            msg.includes('cancelled') ||
            msg.includes('rejected the request')
          );
        };
        const isPhantomGenericFail = (err: unknown): boolean => {
          const msg = ((err as Error)?.message || '').toLowerCase();
          return msg.includes('unexpected error');
        };

        if (signIn) {
          try {
            const origin =
              typeof window !== 'undefined' ? window.location.origin : '';
            let uri = origin;
            let domain = '';
            try {
              const u = new URL(origin);
              uri = u.origin;
              domain = u.host;
            } catch {
              // origin already malformed; let the wallet fill the gap.
            }
            const out = await signIn({
              domain: nonceData.domain ?? domain ?? undefined,
              address: walletAddr,
              statement: 'Authenticate this wallet to start your Vizzor session.',
              uri: nonceData.uri ?? uri ?? undefined,
              version: '1',
              chainId: nonceData.chainId,
              nonce: nonceData.nonce,
              issuedAt: nonceData.issuedAt,
              expirationTime: nonceData.expiresAt,
            });
            signedMessageB64 = base64Encode(out.signedMessage);
            sigB58 = base58Encode(out.signature);
          } catch (signInErr) {
            if (isUserRejection(signInErr)) throw signInErr;
            if (!signMessage || !isPhantomGenericFail(signInErr)) throw signInErr;
            if (typeof console !== 'undefined') {
              console.warn(
                '[vizzor] signIn returned generic error, falling back to signMessage',
                formatCauseChain(walkErrorChain(signInErr)),
              );
            }
          }
        }

        if (sigB58 === null) {
          if (!signMessage) {
            await fail('verify_failed', 'no_sign_primitive');
            return;
          }
          const messageBytes = new TextEncoder().encode(nonceData.message);
          const sigBytes = await signMessage(messageBytes);
          sigB58 = base58Encode(sigBytes);
        }

        const verifyRes = await fetch('/api/auth/siws/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            wallet: walletAddr,
            signature: sigB58,
            action: 'login',
            issuedAt: nonceData.issuedAt,
            expiresAt: nonceData.expiresAt,
            ...(signedMessageB64 ? { signedMessage: signedMessageB64 } : {}),
          }),
        });
        const verifyData = (await verifyRes.json()) as {
          ok: boolean;
          reason?: string;
        };
        if (!verifyData.ok) {
          await fail('verify_failed', verifyData.reason);
          return;
        }
        onStatus('success');
      } catch (e) {
        const err = e as Error & { error?: unknown; name?: string };
        const causeChain = walkErrorChain(err);
        if (typeof console !== 'undefined') {
          console.warn('[vizzor] siws sign rejected', causeChain);
        }
        // Pre-flight `wrong_chain` throws via Error message — recover.
        if (err.message?.startsWith('wrong_chain:')) {
          await fail('wrong_chain', err.message.slice('wrong_chain:'.length));
          return;
        }
        // Classify properly: a real user rejection ("User rejected
        // the request") stays `user_rejected`; a generic
        // `WalletConnectionError: Unexpected error` becomes
        // `stale_session` so the recovery hint is correct.
        const code = classifyConnectError(err);
        // Append the walked cause chain to the detail string so the
        // dev-only modal line can surface it. Format:
        // `<top>: <msg> ← <inner>: <msg> ← ...`
        const detail = formatCauseChain(causeChain) || err.message || 'sign_failed';
        await fail(code, detail);
      }
    })();
  }, [connected, publicKey, wallet, signIn, signMessage, fail, onStatus]);

  return null;
}

/**
 * Minimal base64 encoder for an arbitrary Uint8Array. The wallet
 * `signIn` output bytes are not guaranteed to be base58-friendly
 * (the wallet may prefix domain confirmation bytes per spec), so we
 * use base64 for that channel and reserve base58 for the 64-byte
 * ed25519 signature.
 */
function base64Encode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  if (typeof btoa === 'function') return btoa(bin);
  // Server / non-browser fallback — shouldn't hit in this `'use client'`
  // module, but keeps typecheck honest under noUncheckedIndexedAccess.
  return Buffer.from(bin, 'binary').toString('base64');
}

/**
 * Minimal base58 encoder — inline so we don't pull `bs58` (and its
 * Buffer polyfill) into the client bundle just for one signature.
 * Same algorithm bitcoin / Solana use everywhere.
 */
function base58Encode(bytes: Uint8Array): string {
  const ALPHABET =
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = '';
  while (n > 0n) {
    s = ALPHABET[Number(n % 58n)] + s;
    n = n / 58n;
  }
  for (const b of bytes) {
    if (b === 0) s = '1' + s;
    else break;
  }
  return s;
}
