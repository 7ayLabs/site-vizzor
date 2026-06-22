'use client';

// ---------------------------------------------------------------------------
// CliPairIsland — client-side bridge between the SIWS session and the
// /api/cli-pair/mint endpoint. Kept as an island (not the whole page) so
// the actual token never lands in the server-rendered HTML — we fetch it
// from the client after first paint.
//
// Two states:
//   1. Not signed in  -> "Connect wallet" CTA that redirects to the
//      site's existing wallet-connect flow with returnTo=/cli-pair so
//      the operator lands back here automatically after signing.
//   2. Signed in      -> on mount, POST /api/cli-pair/mint, render the
//      token in a copy-able code block + manual "Regenerate" button.
// ---------------------------------------------------------------------------

import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import { Check, Copy, RotateCw } from 'lucide-react';
import { WalletAuthButton } from '@/components/auth/wallet-auth-button';

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

export function CliPairIsland(props: CliPairIslandProps): ReactElement {
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
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-6">
        <p className="mb-4 text-sm text-zinc-300">
          Sign in with your wallet to mint a CLI token. The site uses
          Sign-In-With-Solana — no transaction, no gas. After signing,
          this page refreshes and the token appears here automatically.
        </p>
        {/* WalletAuthButton opens its own selector modal + handles the
            SIWS dance. We pass `useModal` so it shows the picker even
            without an outer Solana wallet provider on this page. */}
        <WalletAuthButton useModal />
        <p className="mt-4 text-xs text-zinc-500">
          Tip: if the modal doesn't auto-open, click the wallet icon in the
          page header.
        </p>
      </div>
    );
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

function truncate(addr: string | null): string {
  if (!addr) return '—';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}
