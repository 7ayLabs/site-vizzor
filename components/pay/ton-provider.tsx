'use client';

/**
 * TonProvider — wraps children in the TON Connect SDK provider.
 *
 * Lazy-loaded via `next/dynamic({ ssr: false })` by CheckoutShell so
 * the ~120KB TON Connect bundle ships only to /pay/* routes. The
 * manifest URL is build-time inlined; default points at the static
 * file we ship in /public/tonconnect-manifest.json so dev works out
 * of the box.
 */

import { TonConnectUIProvider } from '@tonconnect/ui-react';
import type { ReactNode } from 'react';

const DEFAULT_MANIFEST =
  process.env.NEXT_PUBLIC_TON_CONNECT_MANIFEST_URL ??
  (typeof window !== 'undefined'
    ? `${window.location.origin}/tonconnect-manifest.json`
    : 'https://vizzor.ai/tonconnect-manifest.json');

export function TonProvider({ children }: { children: ReactNode }) {
  return (
    <TonConnectUIProvider manifestUrl={DEFAULT_MANIFEST}>
      {children}
    </TonConnectUIProvider>
  );
}
