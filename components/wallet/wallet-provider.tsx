'use client';

/**
 * Solana wallet provider tree — Phantom + Solflare adapters.
 *
 * Heavy bundle (~300KB gzipped) so this module is ONLY imported via
 * `next/dynamic({ ssr: false })` from the predict route. The home page,
 * docs, etc. never include this code. The dynamic import is also gated
 * on `isTokenLive()` so the wallet bundle isn't even fetched until the
 * $VIZZOR token launches and the flag flips.
 *
 * `WalletModalProvider` brings the upstream-styled connect modal; the
 * connect/burn buttons themselves are rendered in Vizzor's design
 * language (see ./wallet-connect.tsx, ./burn-button.tsx) and call
 * `useWalletModal()` to open it on demand.
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
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import { solanaRpcUrl } from '@/lib/solana';

import '@solana/wallet-adapter-react-ui/styles.css';

export default function WalletAdapter({ children }: { children: ReactNode }) {
  const endpoint = solanaRpcUrl();
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
