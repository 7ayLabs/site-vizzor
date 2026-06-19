'use client';

/**
 * WalletAuthButton — header-mounted SIWS connect/disconnect.
 *
 * Three visual states:
 *   1. Signed out, wallet not connected → "Sign in with Solana"
 *   2. Wallet connected, not yet signed → "Sign message" (auto-fires
 *      the SIWS nonce → sign → verify flow)
 *   3. Signed in → wallet-short badge + tier pill, click to disconnect
 *
 * The Solana wallet adapter chunk is already loaded on /predict + /pay;
 * this component reuses it. To avoid mounting the adapter globally
 * (would bloat home page), we render only the "Connect Solana wallet"
 * link until the user actually clicks → then we lazy-route them to
 * /predict (which mounts the adapter) and they finish auth there.
 *
 * In practice this is wrapped by the wallet provider on the routes
 * that need it (/pay/*, /predict). For pages without the provider
 * (home, /pricing, /docs), the button reads the auth session via
 * /api/auth/session and shows the badge — but a fresh sign-in needs
 * a wallet-provider-bearing route.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';
import { Wallet, LogOut, Check, UserCircle2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { WalletSelectorModal } from './wallet-selector-modal';

interface AuthState {
  ok: boolean;
  signedIn: boolean;
  wallet?: string;
  expiresAt?: number;
  subscription?: {
    tier: string;
    cadence: string;
    expiresAt: number | null;
    isLifetime: boolean;
  } | null;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface WalletAuthButtonProps {
  /** When true, expects to be mounted inside the Solana wallet
   *  provider tree (sign-in flow available). When false, only shows
   *  the badge if already signed in. */
  hasProvider?: boolean;
  /** Force the selector-modal UX even when an outer wallet provider is
   *  mounted (e.g. the in-composer Connect-wallet button on /predict).
   *  The modal then skips its own inner LazyWalletAdapter mount so it
   *  shares the host's provider context — preventing the dual-provider
   *  stall where Phantom never pops on connect. */
  useModal?: boolean;
}

export function WalletAuthButton({
  hasProvider = false,
  useModal = false,
}: WalletAuthButtonProps) {
  const t = useTranslations('auth');
  const { data, mutate } = useSWR<AuthState>('/api/auth/session', fetcher, {
    revalidateOnFocus: false,
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signedIn = data?.signedIn === true;

  if (signedIn && data) {
    return <SignedInBadge state={data} onSignOut={async () => {
      await fetch('/api/auth/session', { method: 'DELETE' });
      void mutate();
    }} />;
  }

  if (!hasProvider || useModal) {
    // Two cases land here:
    //   1. The host page has no wallet provider mounted (navbar on
    //      marketing pages). The modal mounts its own adapter.
    //   2. The host page DOES have a provider (e.g. /predict) but the
    //      caller explicitly asked for the modal UX. The modal then
    //      shares the host provider via hasOuterProvider=true.
    return (
      <ProviderlessConnect
        label={t('connect')}
        hasOuterProvider={hasProvider}
      />
    );
  }

  return (
    <ConnectFlow
      busy={busy}
      setBusy={setBusy}
      error={error}
      setError={setError}
      onSignedIn={() => void mutate()}
    />
  );
}

/* ────────────── signed-in badge ────────────── */

function SignedInBadge({
  state,
  onSignOut,
}: {
  state: AuthState;
  onSignOut: () => void | Promise<void>;
}) {
  const t = useTranslations('auth');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Click-outside + Escape — the dropdown dismisses cleanly without
  // disappearing on incidental hover-out. The listener attaches only
  // while open so the navbar pays nothing in idle.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!state.wallet) return null;

  const short = `${state.wallet.slice(0, 4)}…${state.wallet.slice(-4)}`;
  const sub = state.subscription;
  const tierBadge = sub
    ? sub.isLifetime
      ? `${capitalize(sub.tier)} · ${t('lifetime')}`
      : `${capitalize(sub.tier)} ${sub.cadence}`
    : null;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="
          inline-flex h-8 items-center gap-1.5 rounded-full
          border border-[var(--border)] bg-[var(--surface-2)] px-3
          text-[11.5px] font-medium text-[var(--fg)]
          hover:bg-[var(--surface)]
          transition-colors
        "
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: 'var(--accent)' }}
          aria-hidden
        />
        <span className="mono tabular">{short}</span>
        {tierBadge && (
          <span className="mono tabular text-[9.5px] uppercase tracking-[0.14em] text-[var(--accent)]">
            · {tierBadge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-50 min-w-[220px] border border-[var(--border)] bg-[var(--surface)] shadow-lg"
        >
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <p className="mono tabular text-[9.5px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
              {t('signedInAs')}
            </p>
            <p className="mono tabular text-[11.5px] text-[var(--fg)] break-all mt-1">
              {state.wallet}
            </p>
          </div>
          {sub && (
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <p className="mono tabular text-[9.5px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
                {t('subscription')}
              </p>
              <p className="text-[12.5px] text-[var(--fg)] mt-1">
                {tierBadge}
              </p>
              {sub.expiresAt && (
                <p className="mono tabular text-[10px] text-[var(--fg-3)] mt-0.5">
                  {t('expiresOn', {
                    date: new Date(sub.expiresAt).toLocaleDateString(),
                  })}
                </p>
              )}
            </div>
          )}
          <Link
            href="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="
              w-full flex items-center gap-2 px-4 py-2.5
              text-[12px] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]
              transition-colors border-b border-[var(--border)]
            "
          >
            <UserCircle2 size={13} strokeWidth={2} />
            <span>{t('viewProfile')}</span>
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void onSignOut();
            }}
            className="
              w-full flex items-center gap-2 px-4 py-2.5
              text-[12px] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]
              transition-colors
            "
          >
            <LogOut size={13} strokeWidth={2} />
            <span>{t('signOut')}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ────────────── connect + sign-in flow ────────────── */

function ConnectFlow({
  busy,
  setBusy,
  error,
  setError,
  onSignedIn,
}: {
  busy: boolean;
  setBusy: (v: boolean) => void;
  error: string | null;
  setError: (v: string | null) => void;
  onSignedIn: () => void;
}) {
  const t = useTranslations('auth');
  const {
    publicKey,
    wallet: activeWallet,
    signMessage,
    signIn,
    disconnect,
    connecting,
    connected,
  } = useWallet();
  const { setVisible } = useWalletModal();

  // Auto-fire the SIWS flow once the wallet is connected. The user
  // clicks "Sign in", gets the wallet modal, picks Phantom/etc., and
  // the signature prompt fires immediately on connect.
  useEffect(() => {
    if (!connected || !publicKey || busy) return;
    void runSiws();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey]);

  const runSiws = async () => {
    if (!publicKey || (!signMessage && !signIn)) return;
    setBusy(true);
    setError(null);
    try {
      const wallet = publicKey.toBase58();
      const nonceRes = await fetch('/api/auth/siws/nonce', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ wallet, action: 'login' }),
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
        throw new Error(nonceData.reason ?? 'nonce_failed');
      }

      // Pre-flight: refuse to sign if the active Wallet Standard
      // account doesn't claim the chain the server expects. Mirrors
      // the guard in components/wallet/wallet-connect-flow.tsx.
      const expectedChain = nonceData.chainId;
      if (expectedChain && activeWallet?.adapter) {
        const standardWallet = (
          activeWallet.adapter as unknown as {
            wallet?: { accounts?: ReadonlyArray<{ chains?: readonly string[] }> };
          }
        ).wallet;
        const declaredChains = standardWallet?.accounts?.[0]?.chains;
        if (
          declaredChains &&
          declaredChains.length > 0 &&
          !declaredChains.includes(expectedChain)
        ) {
          throw new Error(`wrong_chain:${expectedChain}`);
        }
      }

      let signedMessageB64: string | null = null;
      let sigB58: string | null = null;

      // SIWS sign cascade — see the equivalent comment in
      // `components/wallet/wallet-connect-flow.tsx`. `signIn` is the
      // canonical Wallet Standard SIWS primitive (works on production
      // / mainnet across all modern Solana wallets). `signMessage` is
      // a silent fallback for Phantom's generic "Unexpected error"
      // from its internal SIWS validation (e.g. localhost+Devnet
      // multi-chain Testnet Mode). User rejections re-throw without
      // fallback.
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
            // fall through to wallet-resolved defaults
          }
          const out = await signIn({
            domain: nonceData.domain ?? domain ?? undefined,
            address: wallet,
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
            );
          }
        }
      }

      if (sigB58 === null) {
        if (!signMessage) {
          throw new Error('no_sign_primitive');
        }
        const sigBytes = await signMessage(
          new TextEncoder().encode(nonceData.message),
        );
        sigB58 = base58Encode(sigBytes);
      }

      const verifyRes = await fetch('/api/auth/siws/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          wallet,
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
        throw new Error(verifyData.reason ?? 'verify_failed');
      }
      onSignedIn();
    } catch (e) {
      const err = e as Error & { cause?: unknown; error?: unknown };
      const chain: { name: string; message: string }[] = [];
      let cursor: unknown = err;
      let depth = 0;
      while (cursor && typeof cursor === 'object' && depth < 6) {
        const c = cursor as { name?: unknown; message?: unknown; cause?: unknown; error?: unknown };
        chain.push({
          name: typeof c.name === 'string' ? c.name : 'Error',
          message: typeof c.message === 'string' ? c.message : '',
        });
        cursor = c.cause ?? c.error;
        depth += 1;
      }
      if (typeof console !== 'undefined') {
        console.warn('[vizzor] siws sign rejected', chain);
      }
      setError(err.message);
      try {
        await disconnect();
      } catch {
        // ignored
      }
    } finally {
      setBusy(false);
    }
  };

  const onClick = () => {
    setError(null);
    if (connected) {
      void runSiws();
    } else {
      setVisible(true);
    }
  };

  const label = busy
    ? t('signing')
    : connecting
      ? t('connecting')
      : connected
        ? t('sign')
        : t('connect');

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy || connecting}
        className="
          inline-flex h-8 items-center gap-1.5 rounded-full
          border border-[var(--border)] bg-transparent px-3
          text-[11.5px] font-medium text-[var(--fg-2)]
          hover:bg-[var(--surface-2)] hover:text-[var(--fg)]
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors
        "
      >
        {busy ? <Check size={13} strokeWidth={2} /> : <Wallet size={13} strokeWidth={2} />}
        <span>{label}</span>
      </button>
      {error && (
        <span className="mono tabular text-[9.5px] uppercase tracking-[0.14em] text-[var(--danger)]">
          {error}
        </span>
      )}
    </div>
  );
}

function base64Encode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  if (typeof btoa === 'function') return btoa(bin);
  return Buffer.from(bin, 'binary').toString('base64');
}

function base58Encode(bytes: Uint8Array): string {
  // Minimal base58 encoder. Pulling bs58 into the client bundle is
  // overkill for one 64-byte signature; this is the canonical
  // algorithm and ~30 lines of code.
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

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/* ────────────── providerless connect (opens selector modal) ────────────── */

function ProviderlessConnect({
  label,
  hasOuterProvider = false,
}: {
  label: string;
  hasOuterProvider?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="
          group relative inline-flex h-8 items-center gap-1.5
          px-1
          text-[12px] font-medium text-[var(--fg-3)]
          transition-[color,transform] duration-200 ease-out
          hover:text-[var(--fg)] hover:scale-[1.03]
          active:scale-[0.97]
          focus-visible:outline-none focus-visible:ring-2
          focus-visible:ring-[var(--accent)] focus-visible:rounded-md
        "
      >
        <Wallet
          size={14}
          strokeWidth={1.75}
          className="transition-transform duration-200 ease-out group-hover:-rotate-6"
        />
        <span>{label}</span>
        {/* Hover underline grows from left — a Linear-style affordance
            without taking up an idle pixel. */}
        <span
          aria-hidden
          className="
            pointer-events-none absolute left-1 right-1 -bottom-0.5
            h-px origin-left scale-x-0
            bg-[var(--fg)]
            transition-transform duration-300 ease-out
            group-hover:scale-x-100
          "
        />
      </button>
      <WalletSelectorModal
        open={open}
        onClose={() => setOpen(false)}
        hasOuterProvider={hasOuterProvider}
      />
    </>
  );
}
