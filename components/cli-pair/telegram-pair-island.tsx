'use client';

// ---------------------------------------------------------------------------
// TelegramPairIsland — companion to CliPairIsland for the /telegram-pair
// flow. Mirrors the same wallet-provider topology that fixed the Phantom
// detection on /cli-pair (outer SolanaWalletAdapter with autoConnect=false,
// hasProvider+useModal on WalletAuthButton, dev-bypass when
// NEXT_PUBLIC_ALLOW_DEV_AUTH=true).
//
// Two states:
//   1. Not signed in -> ConnectGate with WalletAuthButton + dev bypass
//   2. Signed in     -> auto-POST /api/telegram-pair/link to write the
//      wallet_links row, then render a success card with the resolved tier
// ---------------------------------------------------------------------------

import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { Check, Loader2, RotateCw } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { WalletAuthButton } from '@/components/auth/wallet-auth-button';

const SolanaWalletAdapter = dynamic(() => import('@/components/wallet/wallet-provider'), {
  ssr: false,
  loading: () => null,
});

interface TelegramPairIslandProps {
  isSignedIn: boolean;
  walletAddress: string | null;
  telegramUserId: number;
}

interface SessionInfo {
  wallet: string | null;
}

interface LinkResponse {
  ok: true;
  walletAddress: string;
  telegramUserId: number;
  tier: 'free' | 'pro' | 'elite';
}

const sessionFetcher = (url: string): Promise<SessionInfo> =>
  fetch(url, { credentials: 'include' }).then((r) =>
    r.ok ? (r.json() as Promise<SessionInfo>) : { wallet: null },
  );

export function TelegramPairIsland(props: TelegramPairIslandProps): ReactElement {
  return (
    <SolanaWalletAdapter autoConnect={false}>
      <TelegramPairIslandInner {...props} />
    </SolanaWalletAdapter>
  );
}

function TelegramPairIslandInner(props: TelegramPairIslandProps): ReactElement {
  const { isSignedIn: serverIsSignedIn, walletAddress: serverWallet, telegramUserId } = props;
  const { data: session } = useSWR<SessionInfo>('/api/auth/session', sessionFetcher, {
    fallbackData: { wallet: serverWallet },
    refreshInterval: 2000,
    revalidateOnFocus: true,
  });
  const isSignedIn = (session?.wallet ?? null) !== null || serverIsSignedIn;
  const walletAddress = session?.wallet ?? serverWallet;

  const [link, setLink] = useState<LinkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitLink = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/telegram-pair/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ telegramUserId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as LinkResponse;
      setLink(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [telegramUserId]);

  useEffect(() => {
    if (isSignedIn && !link) void submitLink();
  }, [isSignedIn, link, submitLink]);

  if (!isSignedIn) {
    return <ConnectGate />;
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="text-sm text-zinc-400">
          <div>Signed in as</div>
          <div className="font-mono text-xs text-zinc-200">{truncate(walletAddress)}</div>
        </div>
        {busy ? (
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Linking…
          </div>
        ) : null}
      </div>

      {error ? (
        <>
          <div className="mb-3 rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
          <button
            type="button"
            onClick={() => void submitLink()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-50"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </>
      ) : null}

      {link ? (
        <div className="rounded-md border border-emerald-900/60 bg-emerald-950/30 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-emerald-300">
            <Check className="h-4 w-4" />
            Telegram linked
          </div>
          <p className="mb-3 text-xs text-emerald-200/80">
            Wallet <code>{truncate(link.walletAddress)}</code> is bound to
            Telegram user <code>{link.telegramUserId}</code>. Your bot tier
            is <span className="font-semibold uppercase">{link.tier}</span>.
          </p>
          <p className="text-xs text-zinc-500">
            Switch back to Telegram. Send the bot any command (e.g.{' '}
            <code>/me</code> or <code>/predict BTC</code>) and you'll see
            your new tier reflected immediately.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ConnectGate(): ReactElement {
  const { wallets } = useWallet();
  const hasReady = wallets.some(
    (w) =>
      w.adapter.readyState === WalletReadyState.Installed ||
      w.adapter.readyState === WalletReadyState.Loadable,
  );
  const allowDevAuth = process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH === 'true';

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-6">
      <p className="mb-4 text-sm text-zinc-300">
        Sign in with your wallet to link your Telegram account. The site
        uses Sign-In-With-Solana — no transaction, no gas. After signing,
        this page automatically writes the link.
      </p>
      {hasReady ? (
        <WalletAuthButton hasProvider useModal />
      ) : (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Detecting wallets…
        </div>
      )}
      <p className="mt-4 text-xs text-zinc-500">
        Tip: if the connect button hangs, unlock Phantom first and refresh.
      </p>
      {allowDevAuth ? <DevAuthBypass /> : null}
    </div>
  );
}

function DevAuthBypass(): ReactElement {
  const DEFAULT_DEV_WALLET = 'So11111111111111111111111111111111111111112';
  const [wallet, setWallet] = useState(DEFAULT_DEV_WALLET);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trigger = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/dev-sign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ wallet }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-md border border-amber-900/50 bg-amber-950/20 p-4">
      <p className="mb-2 text-xs uppercase tracking-wider text-amber-300">
        Dev mode — wallet bypass
      </p>
      <p className="mb-3 text-xs text-amber-200/80">
        NEXT_PUBLIC_ALLOW_DEV_AUTH is on. Skip the wallet selector and
        mint a session for any address.
      </p>
      <input
        type="text"
        value={wallet}
        onChange={(e) => setWallet(e.target.value)}
        placeholder="Solana address (base58)"
        className="mb-2 w-full rounded-md border border-amber-900/40 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-amber-700"
      />
      <button
        type="button"
        onClick={() => void trigger()}
        disabled={busy || !wallet.trim()}
        className="inline-flex items-center gap-2 rounded-md bg-amber-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {busy ? 'Signing…' : 'Dev-sign as this wallet'}
      </button>
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}

function truncate(addr: string | null): string {
  if (!addr) return '—';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}
