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
// requested wallet before declaring it not installed. Discovery
// usually fires within a single frame of mount, but some extensions
// register late after window.load — 1.5s is a generous ceiling that
// still feels responsive when the wallet truly isn't installed.
const READY_TIMEOUT_MS = 1500;

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
      const url = INSTALL_URLS[providerId];
      if (url && typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      void fail('wallet_not_installed', targetName);
    }, READY_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [providerId, wallets, select, setVisible, onStatus, fail]);

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
