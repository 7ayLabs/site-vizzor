'use client';

/**
 * Solana wallet provider tree — Wallet Standard discovery.
 *
 * Heavy bundle (~300KB gzipped) so this module is ONLY imported via
 * `next/dynamic({ ssr: false })` from the predict route. The home page,
 * docs, etc. never include this code.
 *
 * IMPORTANT — wallet selection correctness:
 *
 * Earlier we passed `[PhantomWalletAdapter, SolflareWalletAdapter]` to
 * `WalletProvider`. Those legacy adapters identify their wallet by
 * sniffing `window.solana?.isPhantom` (and similar) — but Brave's
 * built-in wallet ALSO injects `window.solana` and sets
 * `isPhantom: true` for "Phantom compatibility". The legacy adapter
 * then picks up Brave's injection instead of the user's actual
 * Phantom extension, opening the Brave wallet popup when the user
 * clicked Phantom in our modal.
 *
 * The fix is the **Wallet Standard** discovery path: each wallet
 * registers itself with a unique name (`"Phantom"`, `"Solflare"`,
 * `"Brave Wallet"`, `"Backpack"`, etc.) via `window.navigator.wallets`.
 * `WalletProvider` in `@solana/wallet-adapter-react@0.15.34+`
 * auto-discovers these and exposes them through `useWallet().wallets`
 * with their canonical names. Calling `select('Phantom')` then
 * resolves to the real Phantom extension only — Brave Wallet is its
 * own entry and only matches if the user explicitly picks it.
 *
 * Passing an empty `wallets` array here disables the legacy
 * window-sniffing path entirely; the only wallets that appear are the
 * Wallet-Standard-compliant ones the user has actually installed.
 *
 * `WalletModalProvider` brings the upstream-styled connect modal we
 * fall back to for the "More wallets" entry; the connect/burn buttons
 * themselves are rendered in Vizzor's design language.
 *
 * Default-exported (not named) so the `dynamic(import(...))` import path
 * resolves directly to the component without a `.then(m => m.X)` wrap.
 */

import { useMemo, type ReactNode } from 'react';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
// `@solana/wallet-adapter-wallets` is the umbrella package we depend on;
// it re-exports the individual adapters. Importing through it avoids
// adding a direct dependency on `@solana/wallet-adapter-solflare`.
import { SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { solanaRpcUrl } from '@/lib/solana';
import { paymentNetwork } from '@/lib/payment/network';

import '@solana/wallet-adapter-react-ui/styles.css';

export interface WalletAdapterProps {
  children: ReactNode;
  /**
   * Forwards to `WalletProvider`'s `autoConnect`. The default `true`
   * is right for long-lived surfaces like `/predict` where we want
   * trusted wallets to reconnect silently on mount. The navbar
   * connect modal passes `false` because its adapter is ephemeral —
   * we explicitly drive the connect call from `WalletConnectFlow`
   * via `useWallet().connect()` so we can `try/catch` the error
   * cleanly and surface it inside the modal instead of leaking
   * unhandled `WalletConnectionError`s to the dev console.
   */
  autoConnect?: boolean;
}

export default function WalletAdapter({
  children,
  autoConnect = true,
}: WalletAdapterProps) {
  const endpoint = solanaRpcUrl();
  // Wallet selection policy:
  //
  //   * **Phantom — Wallet Standard ONLY.** We intentionally do NOT
  //     register `PhantomWalletAdapter` here. That legacy adapter
  //     detects Phantom by looking for `isPhantom: true` on
  //     `window.phantom?.solana || window.solana`, and Brave Wallet
  //     impersonates Phantom by setting that exact flag on its own
  //     `window.solana` injection. With the legacy adapter present,
  //     clicking "Phantom" opens Brave's wallet on Brave browsers.
  //
  //     Phantom registers itself via the Solana Wallet Standard at
  //     `window.navigator.wallets` with name `"Phantom"` and a
  //     dedicated internal API that Brave cannot intercept. Brave
  //     Wallet registers separately as `"Brave Wallet"`. So when the
  //     navbar modal calls `select('Phantom')`, only the actual
  //     Phantom extension matches — Brave is a distinct entry the
  //     user only sees if they explicitly pick it from "More wallets".
  //
  //   * **Solflare — legacy adapter.** Brave does not spoof Solflare
  //     (`isSolflare`), so the direct-injection path is safe and
  //     gives us synchronous detection on mount. Wallet Standard
  //     coverage is also there in parallel as a backup.
  //
  // Wallet registration policy:
  //
  //   * **Phantom — Wallet Standard only.** Not pre-registered (see the
  //     Brave/`isPhantom` spoof rationale above). Modern Phantom
  //     auto-injects via `window.navigator.wallets`; `WalletProvider`
  //     surfaces it reactively the moment the registration event fires.
  //   * **Solflare — legacy adapter pre-registered.** Brave does NOT
  //     impersonate Solflare's `isSolflare` flag, so the legacy
  //     direct-injection path is safe. Pre-registering buys us two
  //     things that pure Wallet Standard discovery doesn't deliver
  //     reliably:
  //       1. **Synchronous availability on mount.** Wallet Standard
  //          registration for Solflare lands later than Phantom on
  //          some Chromium builds (Brave especially), and the
  //          discovery race let the `READY_TIMEOUT_MS` fire before
  //          Solflare surfaced — the modal flipped straight to
  //          `wallet_not_installed` and the user saw "Solflare didn't
  //          open."
  //       2. **Built-in web-wallet fallback.** The
  //          `SolflareWalletAdapter.connect()` flow opens
  //          `https://solflare.com/access-wallet` when no extension is
  //          detected, so visitors without the browser extension can
  //          still sign in via the Solflare web wallet. Pure
  //          Wallet-Standard discovery sees nothing in that case and
  //          the adapter never enters its fallback branch.
  //     The legacy entry passes the active `network` so the adapter
  //     can route to the right Solflare cluster URL (mainnet /
  //     testnet / devnet) when the web-wallet fallback fires.
  //
  // `WalletProvider` deduplicates: if Solflare also registers via
  // Wallet Standard, it appears once — the canonical Wallet Standard
  // entry wins, and our legacy pre-registration is only the safety
  // net for the discovery-race case.
  const wallets = useMemo(
    () => [
      new SolflareWalletAdapter({
        network:
          paymentNetwork() === 'mainnet'
            ? WalletAdapterNetwork.Mainnet
            : paymentNetwork() === 'testnet'
              ? WalletAdapterNetwork.Testnet
              : WalletAdapterNetwork.Devnet,
      }),
    ],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider
        wallets={wallets}
        autoConnect={autoConnect}
        // Swallow at the provider boundary — the connect flow already
        // surfaces user-facing errors via its own `onError` callback
        // path. Without this, the wallet-adapter throws unhandled
        // promise rejections into Next's dev overlay every time a
        // user closes the wallet popup.
        onError={() => {}}
      >
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
