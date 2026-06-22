'use client';

// ---------------------------------------------------------------------------
// CliPairIsland — bridge between the SIWS session and the
// /api/cli-pair/mint endpoint. Mirrors the wallet-provider topology used
// by /predict:
//
//   <SolanaWalletAdapter autoConnect={false}>  (dynamic, ssr:false)
//     <CliPairIslandInner />
//   </SolanaWalletAdapter>
//
// And inside the inner shell, the connect CTA is
// `<WalletAuthButton hasProvider useModal />` so the modal shares this
// provider context. That single shared context is what fixes:
//   - Desktop: Phantom extension actually pops the approve popup
//     (without it, the click hangs on "Open Phantom to approve" and
//     the modal surfaces a bogus "Phantom isn't installed" error).
//   - Mobile (iOS/Android): the wallet-adapter's deep-link bridge
//     can hand off to the Phantom / Solflare app since it's running
//     inside an authoritative provider tree.
//
// Two render states inside:
//   1. Not signed in  -> WalletAuthButton + instructions.
//   2. Signed in      -> on mount POST /api/cli-pair/mint and render
//      the token in a copy-able code block + Regenerate button.
//
// Server-side props (`isSignedIn`, `walletAddress`) seed the SWR
// fallback so first paint is correct; the SWR poll catches the
// post-connect transition without requiring a page refresh.
// ---------------------------------------------------------------------------

import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { Check, Copy, RotateCw, Loader2 } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { WalletAuthButton } from '@/components/auth/wallet-auth-button';

// Dynamically import the Solana wallet provider with ssr:false so
// browser-only deps (window, navigator.solana) don't blow up during
// the Next.js server render. Same pattern as /predict.
const SolanaWalletAdapter = dynamic(() => import('@/components/wallet/wallet-provider'), {
  ssr: false,
  loading: () => null,
});

interface SessionInfo {
  wallet: string | null;
}

const sessionFetcher = (url: string): Promise<SessionInfo> =>
  fetch(url, { credentials: 'include' }).then((r) =>
    r.ok ? (r.json() as Promise<SessionInfo>) : { wallet: null },
  );

interface CliPairIslandProps {
  isSignedIn: boolean;
  walletAddress: string | null;
  code: string | null;
}

interface MintResponse {
  token: string;
  walletAddress: string;
  tier: 'free' | 'trial' | 'pro' | 'elite' | 'lifetime';
  expiresAt: number;
  pairedAt: number;
}

/**
 * Outer wrapper that mounts the SolanaWalletAdapter. The actual UI lives
 * in CliPairIslandInner so it can call hooks that depend on the wallet
 * provider context (useWallet, useConnection).
 *
 * autoConnect=false intentionally — see the comment block at the top of
 * predict-shell.tsx. Silent auto-connect leaves Phantom in a state that
 * swallows the next explicit connect() from the selector modal.
 */
export function CliPairIsland(props: CliPairIslandProps): ReactElement {
  return (
    <SolanaWalletAdapter autoConnect={false}>
      <CliPairIslandInner {...props} />
    </SolanaWalletAdapter>
  );
}

function CliPairIslandInner(props: CliPairIslandProps): ReactElement {
  const { isSignedIn: serverIsSignedIn, walletAddress: serverWallet } = props;
  // SWR-driven session detection so the page transitions live the
  // moment WalletAuthButton finishes the SIWS dance — without this,
  // the operator has to refresh after connecting before the mint UI
  // appears, which is exactly the UX we're trying to eliminate.
  const { data: session } = useSWR<SessionInfo>('/api/auth/session', sessionFetcher, {
    fallbackData: { wallet: serverWallet },
    refreshInterval: 2000, // poll every 2s while the user is on this page
    revalidateOnFocus: true,
  });
  const isSignedIn = (session?.wallet ?? null) !== null || serverIsSignedIn;
  const walletAddress = session?.wallet ?? serverWallet;

  const [mint, setMint] = useState<MintResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const requestMint = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch('/api/cli-pair/mint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ttlMinutes: 60 }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Mint failed with HTTP ${res.status}`);
      }
      const json = (await res.json()) as MintResponse;
      setMint(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (isSignedIn) void requestMint();
  }, [isSignedIn, requestMint]);

  if (!isSignedIn) {
    return <ConnectGate />;
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="text-sm text-zinc-400">
          <div>Signed in as</div>
          <div className="font-mono text-xs text-zinc-200">
            {truncate(walletAddress)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void requestMint()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-50"
        >
          <RotateCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
          {busy ? 'Minting…' : 'Regenerate'}
        </button>
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      {mint ? (
        <>
          <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
            <span>
              tier <span className="text-zinc-300">{mint.tier}</span> · expires{' '}
              {new Date(mint.expiresAt * 1000).toLocaleTimeString()}
            </span>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(mint.token);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-800 px-2 py-1 text-zinc-200 transition hover:bg-zinc-700"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </button>
          </div>
          <code className="block break-all rounded-md bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-300">
            {mint.token}
          </code>
          <p className="mt-4 text-xs text-zinc-500">
            Paste this into the Vizzor wizard at the prompt{' '}
            <code className="rounded bg-zinc-800 px-1.5 py-0.5">
              Paste the token from the browser
            </code>
            .
          </p>
        </>
      ) : null}
    </div>
  );
}

/**
 * Connect-wallet gate. Watches the Solana wallet-adapter's `wallets`
 * array and only renders the actual WalletAuthButton once at least one
 * adapter has finished Wallet Standard discovery (readyState === Installed
 * or Loadable). This eliminates the "Phantom isn't installed" false
 * positive that happens when the user clicks Connect within the first
 * second of page load — discovery hadn't completed yet and the connect
 * flow's 6 s timeout was firing before the wallet registered.
 *
 * On /predict this works "by accident" because the gate composer is far
 * below the fold and the user scrolls before clicking. On /cli-pair the
 * button is the first thing they see, so we make readiness explicit.
 */
function ConnectGate(): ReactElement {
  const { wallets } = useWallet();
  const hasReady = wallets.some(
    (w) =>
      w.adapter.readyState === WalletReadyState.Installed ||
      w.adapter.readyState === WalletReadyState.Loadable,
  );

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-6">
      <p className="mb-4 text-sm text-zinc-300">
        Sign in with your wallet to mint a CLI token. The site uses
        Sign-In-With-Solana — no transaction, no gas. After signing, this
        page automatically swaps to a copyable token.
      </p>
      {hasReady ? (
        <>
          {/* hasProvider+useModal mirrors /predict so the selector modal
              shares this provider tree's context, which makes Phantom
              actually pop the extension popup and lets mobile
              deep-links work. */}
          <WalletAuthButton hasProvider useModal />
        </>
      ) : (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Detecting wallets…
        </div>
      )}
      <p className="mt-4 text-xs text-zinc-500">
        Tip: if the connect button hangs, refresh the page after
        unlocking your wallet. (Phantom needs to be unlocked for the
        Wallet Standard registry to populate.)
      </p>
    </div>
  );
}

function truncate(addr: string | null): string {
  if (!addr) return '—';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}
