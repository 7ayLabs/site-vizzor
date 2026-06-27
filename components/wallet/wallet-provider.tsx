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
import { solanaRpcUrl } from '@/lib/solana';

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
  // Wallet selection policy — Wallet Standard discovery ONLY for both
  // Phantom and Solflare.
  //
  //   * **Phantom.** We do NOT register `PhantomWalletAdapter` here.
  //     That legacy adapter detects Phantom by looking for
  //     `isPhantom: true` on `window.phantom?.solana || window.solana`,
  //     and Brave Wallet impersonates Phantom by setting that exact
  //     flag on its own `window.solana` injection. With the legacy
  //     adapter present, clicking "Phantom" opens Brave's wallet on
  //     Brave browsers. Phantom registers itself via the Solana Wallet
  //     Standard at `window.navigator.wallets` with name `"Phantom"`
  //     and a dedicated internal API that Brave cannot intercept.
  //     Brave Wallet registers separately as `"Brave Wallet"`.
  //
  //   * **Solflare.** Previously we pre-registered
  //     `SolflareWalletAdapter` for two reasons: synchronous mount
  //     availability (the Wallet Standard discovery race on Brave was
  //     flipping the modal to `wallet_not_installed` before Solflare
  //     surfaced) and the built-in web-wallet fallback to
  //     `solflare.com/access-wallet` for visitors without the
  //     extension.
  //
  //     We removed it because the pre-registered adapter ran alongside
  //     Wallet Standard's auto-discovered Solflare entry, and the
  //     resulting double-registration leaked EventEmitter listeners
  //     across modal retries — `MaxListenersExceededWarning` crossed
  //     Node's default 10 by the 2nd–3rd attempt and corrupted the
  //     Phantom content-script port multiplexer, surfacing as the
  //     classic Phantom `signIn() → "Unexpected error"`. The
  //     discovery-race symptom is already covered by the existing 6s
  //     `READY_TIMEOUT_MS` in `wallet-connect-flow.tsx`; we accept the
  //     loss of the Solflare web-wallet fallback for visitors with no
  //     extension installed (they fall through to the existing
  //     `wallet_not_installed` flow which opens the install URL).
  //
  // Passing an empty `wallets` array disables both legacy paths and
  // lets `WalletProvider` source every wallet entry from Wallet
  // Standard alone.
  const wallets = useMemo(() => [], []);

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
