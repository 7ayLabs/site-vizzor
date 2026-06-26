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
import {
  Wallet,
  LogOut,
  Check,
  UserCircle2,
  ArrowUpRight,
  Repeat2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { WalletSelectorModal } from './wallet-selector-modal';
import { paymentNetwork } from '@/lib/payment/network';
import { buildSolscanAccountUrl } from '@/lib/explorer/solana';

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
    // Without these the navbar tier badge stayed stale after a
    // successful subscription — the user had to hard-reload to see
    // their new plan. Same pattern as the quota SWR: poll + foreground
    // refetch handles mobile tab-switch returns.
    refreshInterval: 20_000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signedIn = data?.signedIn === true;

  if (signedIn && data) {
    return (
      <SignedInBadge
        state={data}
        hasProvider={hasProvider}
        onSignOut={async () => {
          await fetch('/api/auth/session', { method: 'DELETE' });
          void mutate();
        }}
      />
    );
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
  hasProvider,
  onSignOut,
}: {
  state: AuthState;
  /** True when mounted inside a Solana wallet adapter tree (app shell,
   *  /predict, /pay). Unlocks the chain pill + Switch Wallet +
   *  Disconnect menu items that need `useWallet()`. False on marketing
   *  pages — badge falls back to server-only Sign Out. */
  hasProvider: boolean;
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
          text-[12px] font-semibold tracking-tight text-[var(--fg)]
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
          className="
            absolute right-0 top-full mt-2 z-50 min-w-[240px]
            rounded-2xl border border-[var(--border)] bg-[var(--surface)]
            shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)]
            overflow-hidden
          "
        >
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <p className="mono tabular text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--fg-3)]">
              {t('signedInAs')}
            </p>
            <p className="mono tabular text-[11.5px] text-[var(--fg)] break-all mt-1.5">
              {state.wallet}
            </p>
          </div>
          {sub && (
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <p className="mono tabular text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--fg-3)]">
                {t('subscription')}
              </p>
              <p className="text-[13px] font-medium tracking-tight text-[var(--fg)] mt-1.5">
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
          {/* Chain pill + explorer link — surfaced inside the menu
              rather than on the trigger so the navbar pill stays
              compact. Read-only display of the active network. */}
          <div className="px-4 py-3 border-b border-[var(--border)] flex flex-col gap-2">
            <p className="mono tabular text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--fg-3)]">
              {t('network')}
            </p>
            <div className="flex items-center justify-between gap-2">
              <span className="mono tabular text-[10.5px] uppercase tracking-[0.16em] px-2 py-0.5 rounded-md bg-[var(--fg)] text-[var(--bg)]">
                Solana {paymentNetwork()}
              </span>
              <a
                href={buildSolscanAccountUrl(state.wallet, paymentNetwork())}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="
                  inline-flex items-center gap-1 text-[11.5px] font-medium tracking-tight
                  text-[var(--fg-2)] hover:text-[var(--fg)]
                  transition-colors
                "
              >
                <span>{t('viewOnExplorer')}</span>
                <ArrowUpRight size={11} strokeWidth={2} />
              </a>
            </div>
          </div>
          <Link
            href="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="
              w-full flex items-center gap-2 px-4 py-2.5
              text-[12.5px] font-medium tracking-tight
              text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]
              transition-colors border-b border-[var(--border)]
            "
          >
            <UserCircle2 size={13} strokeWidth={2} />
            <span>{t('viewProfile')}</span>
          </Link>
          {hasProvider && (
            <WalletAdapterActions
              onAfterAction={() => setOpen(false)}
              onSignOut={onSignOut}
            />
          )}
          {!hasProvider && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void onSignOut();
              }}
              className="
                w-full flex items-center gap-2 px-4 py-2.5
                text-[12.5px] font-medium tracking-tight
                text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]
                transition-colors
              "
            >
              <LogOut size={13} strokeWidth={2} />
              <span>{t('signOut')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Wallet-adapter-dependent menu items. Only rendered when the host
 * page sits inside a WalletProvider tree — otherwise `useWallet()`
 * throws. Owns the dual action contract: Switch Wallet AND Disconnect
 * both clear the server SIWS session before touching the adapter, so
 * the cookie can never out-live the wallet connection.
 */
function WalletAdapterActions({
  onAfterAction,
  onSignOut,
}: {
  onAfterAction: () => void;
  onSignOut: () => void | Promise<void>;
}) {
  const t = useTranslations('auth');
  const tMenu = useTranslations('app.walletMenu');
  const { disconnect } = useWallet();
  const { setVisible } = useWalletModal();

  const handleSwitch = async () => {
    onAfterAction();
    toast.message(tMenu('toast.switching'));
    // Clear the SIWS session BEFORE disconnecting so the next wallet's
    // sign-in flow doesn't race against a still-valid auth cookie that
    // points at the previous wallet. Order matters for security: a
    // stale cookie + new wallet would briefly let the new wallet act
    // as the old one on cached requests.
    try {
      await onSignOut();
      await disconnect();
    } catch {
      // Disconnect can throw if no wallet was selected; safe to ignore.
    }
    setVisible(true);
  };

  const handleDisconnect = async () => {
    onAfterAction();
    try {
      await onSignOut();
      await disconnect();
      toast.success(tMenu('toast.disconnected'));
    } catch (e) {
      toast.error(tMenu('toast.disconnectFailed'), {
        description: (e as Error).message,
      });
    }
  };

  return (
    <>
      <button
        type="button"
        role="menuitem"
        onClick={() => void handleSwitch()}
        className="
          w-full flex items-center gap-2 px-4 py-2.5
          text-[12.5px] font-medium tracking-tight
          text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]
          transition-colors border-b border-[var(--border)]
        "
      >
        <Repeat2 size={13} strokeWidth={2} />
        <span>{tMenu('switchWallet')}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => void handleDisconnect()}
        className="
          w-full flex items-center gap-2 px-4 py-2.5
          text-[12.5px] font-medium tracking-tight
          text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]
          transition-colors
        "
      >
        <LogOut size={13} strokeWidth={2} />
        <span>{tMenu('disconnect')}</span>
      </button>
    </>
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
          if (!isPhantomGenericFail(signInErr)) throw signInErr;

          // Dev-mode silent recovery — same shape as
          // `wallet-connect-flow.tsx`. Phantom's "Unexpected error"
          // on localhost+Devnet comes AFTER the user already tapped
          // Confirm in the SIWS popup, so the auth intent is
          // unambiguous. When the dev-sign endpoint is enabled, mint
          // the session via the bypass instead of re-prompting with
          // signMessage. The route is hard-404'd in production.
          if (process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH === 'true') {
            try {
              const res = await fetch('/api/auth/dev-sign', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ wallet }),
              });
              if (res.ok) {
                onSignedIn();
                return;
              }
            } catch {
              // Network failure — fall through to the signMessage path.
            }
          }

          if (!signMessage) throw signInErr;
          // Only fall back on non-production chains — see the
          // matching comment in `wallet-connect-flow.tsx`.
          const allowFallback =
            nonceData.chainId === 'solana:devnet' ||
            nonceData.chainId === 'solana:testnet';
          if (!allowFallback) throw signInErr;
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
      // Last-chance dev-mode silent recovery — see the equivalent
      // comment in `wallet-connect-flow.tsx`.
      const errMsg = (err.message || '').toLowerCase();
      if (
        process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH === 'true' &&
        errMsg.includes('unexpected error') &&
        publicKey
      ) {
        try {
          const res = await fetch('/api/auth/dev-sign', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ wallet: publicKey.toBase58() }),
          });
          if (res.ok) {
            onSignedIn();
            return;
          }
        } catch {
          // fall through to the normal error surface
        }
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
  const [autoSelect, setAutoSelect] = useState<
    'phantom' | 'solflare' | null
  >(null);

  // Dapp-browser auto-trigger: when the wallet's in-app browser lands
  // the user on `…/predict?action=connect&provider=<id>`, open the
  // modal and forward the provider so the connect dance fires in the
  // same tick. The URL params are stripped via History API so a
  // refresh doesn't loop.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const action = url.searchParams.get('action');
    const provider = url.searchParams.get('provider');
    if (action !== 'connect') return;
    if (provider !== 'phantom' && provider !== 'solflare') return;
    setAutoSelect(provider);
    setOpen(true);
    url.searchParams.delete('action');
    url.searchParams.delete('provider');
    window.history.replaceState({}, '', url.toString());
  }, []);

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
        onClose={() => {
          setOpen(false);
          setAutoSelect(null);
        }}
        hasOuterProvider={hasOuterProvider}
        autoSelectProvider={autoSelect}
      />
    </>
  );
}
