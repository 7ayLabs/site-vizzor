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
}

export function WalletAuthButton({
  hasProvider = false,
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

  if (!hasProvider) {
    // No wallet provider on this route. The Solana adapter bundle is
    // intentionally only loaded on /predict and /pay to keep marketing
    // pages light. So instead of routing immediately, we open the
    // WalletSelectorModal which lets the user pick a provider; each
    // option then deep-routes to the page where the adapter (Solana or
    // TON) actually lives, with a `?connect=<id>` hint the destination
    // route consumes to auto-fire the connect flow.
    return (
      <ProviderlessConnect label={t('connect')} />
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
  const { publicKey, signMessage, disconnect, connecting, connected } = useWallet();
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
    if (!publicKey || !signMessage) return;
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
        issuedAt?: string;
        expiresAt?: string;
        reason?: string;
      };
      if (!nonceData.ok || !nonceData.message) {
        throw new Error(nonceData.reason ?? 'nonce_failed');
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
          wallet,
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
        throw new Error(verifyData.reason ?? 'verify_failed');
      }
      onSignedIn();
    } catch (e) {
      setError((e as Error).message);
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

function ProviderlessConnect({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="
          hidden sm:inline-flex h-8 items-center gap-1.5 rounded-full
          border border-[var(--border)] bg-transparent px-3
          text-[11.5px] font-medium text-[var(--fg-2)]
          hover:bg-[var(--surface-2)] hover:text-[var(--fg)]
          focus-visible:outline-none focus-visible:ring-2
          focus-visible:ring-[var(--accent)]
          transition-colors
        "
      >
        <Wallet size={13} strokeWidth={2} />
        <span>{label}</span>
      </button>
      <WalletSelectorModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
