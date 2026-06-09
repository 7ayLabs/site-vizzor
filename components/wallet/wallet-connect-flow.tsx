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
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import {
  WalletReadyState,
  type WalletName,
} from '@solana/wallet-adapter-base';
import {
  appDeepLinkFor,
  isMobileWeb,
  universalLinkFor,
} from '@/lib/wallet/mobile';

export type SolanaProviderId = 'phantom' | 'solflare' | 'more';

export type ConnectErrorCode =
  | 'wallet_not_installed'
  | 'user_rejected'
  | 'nonce_failed'
  | 'verify_failed'
  | 'unknown';

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
// 3s is still responsive when the wallet truly isn't installed
// (the install URL just opens a beat later) and rescues the Brave
// case without further heuristics.
const READY_TIMEOUT_MS = 3000;

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
    disconnect,
  } = useWallet();
  const { setVisible } = useWalletModal();
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

  // Mobile handoff helper. On iOS / Android in a regular mobile browser
  // (Safari, Chrome, Brave, …) the wallet's browser extension does not
  // exist, so the Wallet Standard registry is empty and select() will
  // never resolve. We hand off to the native wallet app via its custom
  // URL scheme — `phantom://browse/<url>` opens Phantom directly with
  // no website round-trip. If the app isn't installed, we fall back to
  // the universal link (which points at the wallet's install page).
  //
  // Why the custom scheme first: iOS universal-link interception of
  // `phantom.app/ul/*` is gated on the app's associated-domains
  // entitlement being live. After fresh installs or stale iOS link
  // caches the universal link silently degrades into a normal HTTPS
  // navigation and lands the user on phantom.app's website instead
  // of inside the wallet — the exact bug we're fixing here.
  //
  // Visibility-change detection: when the OS hands off to the wallet
  // app, the page's `visibilityState` flips to 'hidden'. We use that
  // as the signal "app opened, cancel the fallback". If the page is
  // still 'visible' after the timeout, the scheme had no handler
  // (app not installed) → fall back to the universal link.
  //
  // Returns true if we initiated a handoff (caller stops the install-
  // page path).
  const tryMobileHandoff = useCallback(
    (id: SolanaProviderId): boolean => {
      if (id === 'more' || !isMobileWeb()) return false;
      const deepLink = appDeepLinkFor(id);
      const universalLink = universalLinkFor(id);
      if (!deepLink || !universalLink) return false;

      let appOpened = false;
      const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') appOpened = true;
      };
      document.addEventListener('visibilitychange', onVisibilityChange);

      // Step 1 — fire the app's custom scheme. iOS / Android dispatch
      // this to the wallet's URL handler if the app is installed; the
      // page typically blurs and visibilityState flips to 'hidden'
      // within ~200ms when handoff succeeds.
      window.location.href = deepLink;

      // Step 2 — short fallback timer. If we're still visible after
      // 1.2s, the scheme had no handler and we fall back to the
      // universal link (which surfaces phantom.app's install / open
      // prompt). 1.2s is enough headroom for the OS to dispatch on
      // a cold launch but short enough that the user doesn't sit on
      // a frozen UI when the app is genuinely missing.
      window.setTimeout(() => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        if (appOpened) return;
        if (document.visibilityState !== 'visible') return;
        window.location.href = universalLink;
      }, 1200);

      return true;
    },
    [],
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
        try {
          // Just select — the second effect below handles the actual
          // `connect()` call once `wallet` settles in the context.
          // We intentionally do NOT rely on the provider's autoConnect
          // here because it issues a `{ silent: true }` connect that
          // can throw `WalletConnectionError: Unexpected error` for
          // untrusted wallets (every first-time visitor).
          select(candidate.adapter.name as WalletName);
        } catch (e) {
          void fail('user_rejected', (e as Error).message);
        }
        return;
      }
      if (state === WalletReadyState.NotDetected) {
        startedRef.current = true;
        // On mobile, "not detected" means there's no extension to detect.
        // Hand off to the wallet app via its universal link — when the
        // user returns the page reloads inside the wallet's webview
        // with the provider present.
        if (tryMobileHandoff(providerId)) return;
        const url = INSTALL_URLS[providerId];
        if (url && typeof window !== 'undefined') {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        void fail('wallet_not_installed', targetName);
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
  }, [providerId, wallets, select, setVisible, onStatus, fail, tryMobileHandoff]);

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
    void (async () => {
      try {
        await connect();
      } catch (e) {
        // Most common: user dismissed the wallet popup. Less common:
        // the wallet's session was revoked or the extension is in a
        // funny state. Either way, surface it as a retryable rejection.
        await fail('user_rejected', (e as Error).message);
        connectingRef.current = false;
      }
    })();
  }, [wallet, connected, connect, fail]);

  // Step 3 — once the wallet is connected, run the SIWS dance. Same
  // happy path as components/auth/wallet-auth-button.tsx but driven
  // here from inside the modal so the user never leaves their page.
  useEffect(() => {
    if (signingRef.current) return;
    if (!connected || !publicKey || !signMessage) return;
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
          issuedAt?: string;
          expiresAt?: string;
          reason?: string;
        };
        if (!nonceData.ok || !nonceData.message) {
          await fail('nonce_failed', nonceData.reason);
          return;
        }

        const sigBytes = await signMessage(
          new TextEncoder().encode(nonceData.message),
        );
        const sigB58 = base58Encode(sigBytes);

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
        // signMessage throws when the user closes the popup or denies.
        await fail('user_rejected', (e as Error).message);
      }
    })();
  }, [connected, publicKey, signMessage, fail, onStatus]);

  return null;
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
