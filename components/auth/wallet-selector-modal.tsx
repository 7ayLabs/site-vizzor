'use client';

/**
 * WalletSelectorModal — navbar-mounted Web3 connect modal.
 *
 * Runs the full connect dance in place on whatever page the user is on
 * (home, /pricing, /docs) — no navigation, no `/predict` redirect. The
 * heavy Solana wallet-adapter bundle (~300KB) is `dynamic({ ssr: false
 * })`-imported only AFTER the user picks a Solana wallet, so marketing
 * pages stay light until the user explicitly opts in.
 *
 * State machine:
 *   closed     — not mounted
 *   opening    — mounted, enter animation
 *   open       — wallet list, idle
 *   connecting — user picked a wallet; adapter loading + select()
 *   signing    — wallet connected; SIWS nonce → sign → verify dance
 *   success    — verify ok; mutate session SWR, auto-close after 1.4s
 *   error      — surface error + retry button
 *   closing    — exit animation, then unmount
 *
 * Accessibility: role=dialog + aria-modal, ESC + backdrop close, focus
 * moves to the first interactive element on open, body-scroll lock
 * while mounted, prefers-reduced-motion respected.
 *
 * Wallet identity uses the Solana Wallet Standard (see
 * `components/wallet/wallet-provider.tsx`) so Brave Wallet's
 * Phantom-impersonation injection never hijacks the Phantom hint.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { useSWRConfig } from 'swr';
import { useRouter } from '@/i18n/navigation';
import { X, Loader2, Check, AlertCircle, ExternalLink } from 'lucide-react';
import type {
  ConnectErrorCode,
  ConnectStatus,
  SolanaProviderId,
} from '@/components/wallet/wallet-connect-flow';
import { SupportCodeChip } from '@/components/ui/support-code-chip';
import { walletConnectCode } from '@/lib/errors';
import {
  isMobileWeb,
  startMobileConnect,
  type DeeplinkProviderId,
} from '@/lib/wallet/deeplink';
import { localizedAbsoluteUrl } from '@/lib/wallet/locale-url';

/* ─────────────── lazy heavy bundles ─────────────── */

const LazyWalletAdapter = dynamic(
  () => import('@/components/wallet/wallet-provider'),
  { ssr: false, loading: () => null },
);

const LazyConnectFlow = dynamic(
  () =>
    import('@/components/wallet/wallet-connect-flow').then((m) => ({
      default: m.WalletConnectFlow,
    })),
  { ssr: false, loading: () => null },
);

/* ─────────────── option config ─────────────── */

export type WalletProviderId = 'phantom' | 'solflare' | 'more';

type IconKind =
  | { kind: 'asset'; src: string; alt: string }
  | { kind: 'glyph'; swatch: string; node: React.ReactNode };

interface WalletProviderOption {
  id: WalletProviderId;
  i18nKey: string;
  captionKey: string;
  /** What happens on click. `solana` connects inline; `ton` and
   *  `route` navigate to a destination that owns its own flow. */
  action: { kind: 'solana'; providerId: SolanaProviderId } | { kind: 'route'; href: string };
  icon: IconKind;
}

const OPTIONS: WalletProviderOption[] = [
  {
    id: 'phantom',
    i18nKey: 'phantom',
    captionKey: 'phantomCaption',
    action: { kind: 'solana', providerId: 'phantom' },
    icon: { kind: 'asset', src: '/wallets/phantom.svg', alt: 'Phantom' },
  },
  {
    id: 'solflare',
    i18nKey: 'solflare',
    captionKey: 'solflareCaption',
    action: { kind: 'solana', providerId: 'solflare' },
    icon: { kind: 'asset', src: '/wallets/solflare.svg', alt: 'Solflare' },
  },
  {
    id: 'more',
    i18nKey: 'more',
    captionKey: 'moreCaption',
    action: { kind: 'solana', providerId: 'more' },
    icon: { kind: 'glyph', swatch: '#6E7681', node: <MoreGlyph /> },
  },
];

/* ─────────────── lifecycle phases ─────────────── */

type Phase =
  | 'closed'
  | 'opening'
  | 'open'
  | 'connecting'
  | 'signing'
  | 'success'
  | 'error'
  | 'closing';

const EXIT_MS = 200;
const SUCCESS_HOLD_MS = 1400;

export interface WalletSelectorModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * When true, an outer Solana wallet-adapter provider is already
   * mounted by the host page (e.g. `/predict`). The modal then renders
   * `<WalletConnectFlow>` directly instead of wrapping it in its own
   * `<LazyWalletAdapter>`. Two nested providers cause Phantom's
   * `connect()` to land in a different context than the one
   * autoConnect already touched on the outer provider — the extension
   * popup never appears. Skipping the inner mount fixes this.
   */
  hasOuterProvider?: boolean;
}

export function WalletSelectorModal({
  open,
  onClose,
  hasOuterProvider = false,
}: WalletSelectorModalProps) {
  const t = useTranslations('auth');
  const router = useRouter();
  const locale = useLocale();
  const { mutate } = useSWRConfig();
  const firstOptionRef = useRef<HTMLButtonElement | null>(null);

  const [phase, setPhase] = useState<Phase>('closed');
  const [mounted, setMounted] = useState(false);
  const [selectedProvider, setSelectedProvider] =
    useState<SolanaProviderId | null>(null);
  const [errorCode, setErrorCode] = useState<ConnectErrorCode | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  // Active connect attempt — bump to force-remount the LazyConnectFlow
  // when the user retries after an error so the start-on-mount effect
  // re-fires.
  const [attempt, setAttempt] = useState(0);

  // Portal target available on client only.
  useEffect(() => {
    setMounted(true);
  }, []);

  /* phase machine driven by the controlled `open` prop */
  useEffect(() => {
    if (open) {
      setPhase((p) => (p === 'closed' || p === 'closing' ? 'opening' : p));
      const id = window.requestAnimationFrame(() =>
        setPhase((p) => (p === 'opening' ? 'open' : p)),
      );
      return () => window.cancelAnimationFrame(id);
    }
    setPhase((p) => (p === 'closed' ? p : 'closing'));
    const id = window.setTimeout(() => {
      setPhase('closed');
      // Reset flow state once fully closed so a re-open starts clean.
      setSelectedProvider(null);
      setErrorCode(null);
      setErrorDetail(null);
    }, EXIT_MS);
    return () => window.clearTimeout(id);
  }, [open]);

  /* ESC + initial focus while idle/open */
  useEffect(() => {
    if (phase !== 'open' && phase !== 'opening') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => firstOptionRef.current?.focus(), 60);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(id);
    };
  }, [phase, onClose]);

  /* body-scroll lock while visible */
  useEffect(() => {
    if (phase === 'closed') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [phase]);

  /* on success: refresh session, auto-close */
  useEffect(() => {
    if (phase !== 'success') return;
    void mutate('/api/auth/session');
    const id = window.setTimeout(onClose, SUCCESS_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [phase, mutate, onClose]);

  /* ─────────────── handlers ─────────────── */

  const handleSelect = useCallback(
    (option: WalletProviderOption) => {
      const action = option.action;
      if (action.kind === 'route') {
        const href = action.href;
        onClose();
        window.setTimeout(() => router.push(href as never), EXIT_MS);
        return;
      }
      // Mobile fast-path — navigate synchronously inside the user's
      // tap handler. iOS Universal Link interception requires the
      // navigation to happen WITHIN the user-gesture window, and
      // routing through React's setState → mount → useEffect chain
      // burns past that window (Safari treats the late
      // `window.location.href = …` as a programmatic navigation and
      // falls through to the wallet's marketing page instead of
      // opening the app). By kicking the deeplink off here we
      // preserve the gesture: tap → kickoff URL → navigation, all
      // synchronous.
      if (
        isMobileWeb() &&
        (action.providerId === 'phantom' || action.providerId === 'solflare')
      ) {
        const deeplinkProvider: DeeplinkProviderId = action.providerId;
        const callbackUrl = localizedAbsoluteUrl(
          '/wallet/callback?step=connect',
          locale,
        );
        const kickoff = startMobileConnect({
          providerId: deeplinkProvider,
          returnTo: window.location.href,
          callbackUrl,
        });
        try {
          window.localStorage.setItem(
            'vizzor.wallet.fallback',
            kickoff.fallbackSchemeUrl,
          );
        } catch {
          // Best-effort — private modes block localStorage and the
          // user can recover via the standard retry path.
        }
        // Android uses the Intent URL (guaranteed app launch + Play
        // Store fallback); iOS uses the Universal Link.
        const target =
          kickoff.platform === 'android'
            ? kickoff.androidIntentUrl
            : kickoff.universalUrl;
        window.location.href = target;
        return;
      }
      // Solana flow — stays in place.
      setErrorCode(null);
      setErrorDetail(null);
      setSelectedProvider(action.providerId);
      setPhase('connecting');
    },
    [locale, onClose, router],
  );

  const handleStatus = useCallback((status: ConnectStatus) => {
    setPhase(status);
  }, []);

  const handleError = useCallback(
    (code: ConnectErrorCode, detail?: string) => {
      setErrorCode(code);
      setErrorDetail(detail ?? null);
      setPhase('error');
    },
    [],
  );

  const handleRetry = useCallback(() => {
    setErrorCode(null);
    setErrorDetail(null);
    setSelectedProvider(null);
    setPhase('open');
    setAttempt((n) => n + 1);
  }, []);

  // Dev-only auth bypass. POSTs `/api/auth/dev-sign`, which is hard-
  // 404'd in production / without the env flag. On success we step
  // straight to the modal's `success` phase, reusing the existing
  // SWR mutation + auto-close timer in the success effect above.
  const handleDevSign = useCallback(async () => {
    if (process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH !== 'true') return;
    setErrorCode(null);
    setErrorDetail(null);
    setPhase('signing');
    try {
      const wallet =
        process.env.NEXT_PUBLIC_DEV_WALLET ??
        window.prompt('Dev wallet address (base58)') ??
        '';
      if (!wallet) {
        setPhase('open');
        return;
      }
      const res = await fetch('/api/auth/dev-sign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ wallet }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
      };
      if (!res.ok || !data.ok) {
        setErrorCode('verify_failed');
        setErrorDetail(data.reason ?? `dev_sign_${res.status}`);
        setPhase('error');
        return;
      }
      setPhase('success');
    } catch (e) {
      setErrorCode('verify_failed');
      setErrorDetail((e as Error).message);
      setPhase('error');
    }
  }, []);

  // The selected option (for icon + label in the loading/success/error
  // screens). For "more" we don't have a meaningful selected wallet so
  // we fall back to a neutral header. MUST stay above the early
  // return so React sees the same hook order across all renders.
  const selectedOption = useMemo(() => {
    if (!selectedProvider) return null;
    return (
      OPTIONS.find(
        (o) =>
          o.action.kind === 'solana' &&
          o.action.providerId === selectedProvider,
      ) ?? null
    );
  }, [selectedProvider]);

  /* ─────────────── render gates ─────────────── */

  if (!mounted || phase === 'closed') return null;

  const exiting = phase === 'closing';
  const showSelect =
    phase === 'open' || phase === 'opening' || phase === 'closing';
  const showLoading = phase === 'connecting' || phase === 'signing';
  const showSuccess = phase === 'success';
  const showError = phase === 'error';

  const backdropAnim = exiting
    ? 'motion-safe:wallet-modal-fade-out'
    : 'motion-safe:wallet-modal-fade-in';
  const cardAnim = exiting
    ? 'motion-safe:wallet-modal-slide-out'
    : 'motion-safe:wallet-modal-slide-in';

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-selector-title"
      className={`fixed inset-0 z-[60] flex items-end sm:items-center justify-center ${backdropAnim}`}
    >
      {/* Backdrop. Closes the modal in every phase — the user always
          needs an escape hatch, especially when the wallet adapter is
          hung waiting for a popup that will never come. A pending
          handshake is harmless to cancel: we never persist anything
          until SIWS verify lands. */}
      <button
        type="button"
        aria-label={t('close')}
        onClick={onClose}
        className="absolute inset-0 bg-[color:color-mix(in_oklab,var(--bg)_70%,black_20%)]/85 backdrop-blur-sm"
      />

      <div
        className={`relative z-10 w-full sm:max-w-[420px] border border-[var(--border)] bg-[var(--surface)] rounded-t-2xl sm:rounded-2xl shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)] flex flex-col ${cardAnim}`}
      >
        <ModalHeader
          phase={phase}
          selectedOption={selectedOption}
          onClose={onClose}
          // Always allow dismissal — even mid-connect. If the wallet
          // adapter is hung waiting for a popup that will never come
          // (locked vault, blocked extension, etc.) the user needs an
          // escape hatch. A pending handshake is harmless to cancel:
          // we never persist anything until SIWS verify lands.
          canDismiss={true}
        />

        {showSelect && (
          <SelectView
            firstOptionRef={firstOptionRef}
            onSelect={handleSelect}
            onDevSign={
              process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH === 'true'
                ? handleDevSign
                : null
            }
          />
        )}

        {showLoading && selectedProvider && (
          <>
            <LoadingView phase={phase} option={selectedOption} />
            {/* Connect flow. When the host page already mounts its own
                Solana provider (e.g. `/predict`), skip the inner
                `<LazyWalletAdapter>` to avoid two nested provider
                trees — the cause of Phantom hanging on
                "Open Phantom to approve" without the extension ever
                popping up. */}
            {hasOuterProvider ? (
              <LazyConnectFlow
                key={attempt}
                providerId={selectedProvider}
                onStatus={handleStatus}
                onError={handleError}
              />
            ) : (
              <LazyWalletAdapter autoConnect={false}>
                <LazyConnectFlow
                  key={attempt}
                  providerId={selectedProvider}
                  onStatus={handleStatus}
                  onError={handleError}
                />
              </LazyWalletAdapter>
            )}
          </>
        )}

        {showSuccess && <SuccessView option={selectedOption} />}

        {showError && (
          <ErrorView
            code={errorCode}
            detail={errorDetail}
            option={selectedOption}
            onRetry={handleRetry}
            onClose={onClose}
            onDevSign={
              process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH === 'true'
                ? handleDevSign
                : null
            }
          />
        )}

        <ModalFooter />
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

/* ──────────────────────────────────────────────────────────
 * Subviews
 * ────────────────────────────────────────────────────────── */

function ModalHeader({
  phase,
  selectedOption,
  onClose,
  canDismiss,
}: {
  phase: Phase;
  selectedOption: WalletProviderOption | null;
  onClose: () => void;
  canDismiss: boolean;
}) {
  const t = useTranslations('auth');
  const isSelect =
    phase === 'open' || phase === 'opening' || phase === 'closing';
  const titleKey = isSelect ? 'modal.title' : 'modal.titleConnecting';
  const eyebrowKey = isSelect ? 'modal.eyebrow' : 'modal.eyebrowConnecting';
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
      <div className="flex flex-col gap-1.5 min-w-0">
        <p className="mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
          {t(eyebrowKey as 'modal.eyebrow')}
        </p>
        <h2
          id="wallet-selector-title"
          className="text-[16px] font-semibold tracking-tight text-[var(--fg)] truncate"
        >
          {isSelect
            ? t(titleKey as 'modal.title')
            : t(titleKey as 'modal.titleConnecting', {
                wallet: selectedOption
                  ? t(`wallets.${selectedOption.i18nKey}` as 'wallets.phantom')
                  : '',
              })}
        </h2>
      </div>
      <button
        type="button"
        onClick={canDismiss ? onClose : undefined}
        disabled={!canDismiss}
        aria-label={t('close')}
        className="-mr-1 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-40 disabled:cursor-default"
      >
        <X size={16} strokeWidth={2} />
      </button>
    </div>
  );
}

function SelectView({
  firstOptionRef,
  onSelect,
  onDevSign,
}: {
  firstOptionRef: React.RefObject<HTMLButtonElement | null>;
  onSelect: (opt: WalletProviderOption) => void;
  /** Non-null only when `NEXT_PUBLIC_ALLOW_DEV_AUTH=true` is set at
   *  build time. Renders a dev-only escape-hatch link below the
   *  wallet list. The endpoint it POSTs to is hard-404'd in prod. */
  onDevSign: (() => Promise<void>) | null;
}) {
  const t = useTranslations('auth');
  return (
    <ul className="px-3 pb-3 flex flex-col gap-1">
      {OPTIONS.map((opt, i) => (
        <li key={opt.id}>
          <button
            type="button"
            ref={i === 0 ? firstOptionRef : undefined}
            onClick={() => onSelect(opt)}
            className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-transparent hover:border-[var(--border)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] transition-colors text-left"
            data-wallet={opt.id}
          >
            <WalletIcon icon={opt.icon} />
            <span className="flex-1 min-w-0 flex flex-col">
              <span className="text-[13.5px] font-medium text-[var(--fg)]">
                {t(`wallets.${opt.i18nKey}` as 'wallets.phantom')}
              </span>
              <span className="mono tabular text-[10.5px] text-[var(--fg-3)] truncate">
                {t(`wallets.${opt.captionKey}` as 'wallets.phantomCaption')}
              </span>
            </span>
            <span
              aria-hidden
              className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)] group-hover:text-[var(--accent)] transition-colors"
            >
              →
            </span>
          </button>
        </li>
      ))}
      {onDevSign && (
        <li className="mt-1 px-3 pt-2 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={() => void onDevSign()}
            className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-3)] hover:text-[var(--accent)] transition-colors"
            data-wallet="dev-sign"
          >
            Dev sign-in (skip wallet) →
          </button>
        </li>
      )}
    </ul>
  );
}

function LoadingView({
  phase,
  option,
}: {
  phase: Phase;
  option: WalletProviderOption | null;
}) {
  const t = useTranslations('auth');
  const titleKey = phase === 'signing' ? 'modal.signing' : 'modal.connecting';
  const subtitleKey =
    phase === 'signing'
      ? 'modal.signingSubtitle'
      : 'modal.connectingSubtitle';
  return (
    <div className="px-5 pt-2 pb-6 flex flex-col items-center gap-4 text-center">
      <div className="relative">
        {option ? (
          <WalletIcon icon={option.icon} large />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--surface-2)] text-[var(--fg-3)]">
            <Loader2 size={22} strokeWidth={2} />
          </span>
        )}
        {/* Spinning ring around the icon — pure CSS, no JS animation. */}
        <span
          aria-hidden
          className="absolute -inset-1.5 rounded-2xl border-2 border-transparent border-t-[var(--accent)] border-r-[var(--accent)] motion-safe:animate-[spin_900ms_linear_infinite]"
        />
      </div>
      <div className="flex flex-col gap-1.5 min-w-0">
        <p className="text-[14px] font-medium text-[var(--fg)]">
          {t(titleKey as 'modal.connecting', {
            wallet: option
              ? t(`wallets.${option.i18nKey}` as 'wallets.phantom')
              : '',
          })}
        </p>
        <p className="mono tabular text-[10.5px] text-[var(--fg-3)] uppercase tracking-[0.14em]">
          {/* `signingSubtitle` interpolates {wallet}; `connectingSubtitle`
              doesn't — passing it harmlessly is fine, next-intl ignores
              unused vars but errors when a referenced var is missing. */}
          {t(subtitleKey as 'modal.connectingSubtitle', {
            wallet: option
              ? t(`wallets.${option.i18nKey}` as 'wallets.phantom')
              : '',
          })}
        </p>
      </div>
    </div>
  );
}

function SuccessView({ option }: { option: WalletProviderOption | null }) {
  const t = useTranslations('auth');
  return (
    <div className="px-5 pt-2 pb-6 flex flex-col items-center gap-4 text-center">
      <div className="relative">
        {option ? (
          <WalletIcon icon={option.icon} large />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)] text-[var(--accent-fg)]">
            <Check size={22} strokeWidth={2.4} />
          </span>
        )}
        <span
          aria-hidden
          className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)] shadow-[0_4px_12px_-2px_rgba(0,0,0,0.4)]"
        >
          <Check size={13} strokeWidth={3} />
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-[14px] font-medium text-[var(--fg)]">
          {t('modal.success')}
        </p>
        <p className="mono tabular text-[10.5px] text-[var(--fg-3)] uppercase tracking-[0.14em]">
          {t('modal.successSubtitle')}
        </p>
      </div>
    </div>
  );
}

function ErrorView({
  code,
  detail,
  option,
  onRetry,
  onClose,
  onDevSign,
}: {
  code: ConnectErrorCode | null;
  detail: string | null;
  option: WalletProviderOption | null;
  onRetry: () => void;
  onClose: () => void;
  /** Non-null when the dev-auth bypass is enabled. We surface it as
   *  a secondary action on `stale_session` errors so the user has a
   *  way out when Phantom is hard-rejecting from internal state we
   *  can't influence. */
  onDevSign: (() => Promise<void>) | null;
}) {
  const t = useTranslations('auth');
  const titleKey = code ? `modal.error.${code}` : 'modal.error.unknown';
  const isNotInstalled = code === 'wallet_not_installed';
  const isStaleSession = code === 'stale_session';
  const isWrongChain = code === 'wrong_chain';
  // For `wrong_chain`, the `detail` is the CAIP-2 chain id we expected
  // (e.g. `solana:devnet`). Surface the human label in the copy.
  const wrongChainLabel = isWrongChain ? humaniseChain(detail) : '';
  // The walked cause chain (Layer 2) is appended to `detail` for
  // non-wrong-chain errors as `Foo: bar ← Baz: qux`. In production we
  // still show it (it's diagnostic, not internal), but only with the
  // first link — the rest is for support tickets via the copy chip.
  const hasCauseChain = Boolean(detail && detail.includes(' ← '));
  const installUrl =
    option && option.action.kind === 'solana'
      ? installUrlFor(option.action.providerId)
      : null;
  const support = walletConnectCode(code ?? 'unknown');

  return (
    <div className="px-5 pt-2 pb-5 flex flex-col items-center gap-4 text-center">
      <span
        aria-hidden
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:color-mix(in_oklab,var(--danger)_18%,var(--surface-2))] text-[var(--danger)]"
      >
        <AlertCircle size={22} strokeWidth={2} />
      </span>
      <div className="flex flex-col gap-2 min-w-0 items-center">
        <p className="text-[14px] font-medium text-[var(--fg)]">
          {t(titleKey as 'modal.error.unknown', {
            wallet: option
              ? t(`wallets.${option.i18nKey}` as 'wallets.phantom')
              : '',
            chain: wrongChainLabel,
          })}
        </p>
        {isStaleSession && (
          <p className="text-[12px] text-[var(--fg-2)] leading-snug max-w-[40ch] whitespace-pre-line">
            {t('modal.error.stale_session_hint', {
              wallet: option
                ? t(`wallets.${option.i18nKey}` as 'wallets.phantom')
                : 'wallet',
            })}
          </p>
        )}
        {isWrongChain && (
          <p className="text-[12px] text-[var(--fg-2)] leading-snug max-w-[40ch] whitespace-pre-line">
            {t('modal.error.wrong_chain_hint', {
              wallet: option
                ? t(`wallets.${option.i18nKey}` as 'wallets.phantom')
                : 'wallet',
              chain: wrongChainLabel,
            })}
          </p>
        )}
        <SupportCodeChip
          code={support.code}
          slug={support.slug}
          copyLabel={t('modal.copyCode')}
          copiedLabel={t('modal.codeCopied')}
        />
        {detail && !isWrongChain && (
          // Preserve the wallet's original error message verbatim
          // (no `uppercase`) so users can search for it / paste it
          // into a support ticket. When Layer 2's verbose capture
          // walked an inner cause chain, `detail` reads:
          //   `WalletSignInError: Unexpected error ← <inner cause>`
          // The split lets support see the underlying reason that
          // Phantom hid behind the generic top-level message.
          <p
            className="mono tabular text-[10px] text-[var(--fg-3)] tracking-[0.04em] break-all max-w-[40ch]"
            data-cause-chain={hasCauseChain ? 'true' : 'false'}
          >
            {detail}
          </p>
        )}
      </div>
      <div className="flex flex-col w-full gap-2 mt-1">
        {isNotInstalled && installUrl && (
          <a
            href={installUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-[12px] font-semibold text-[var(--accent-fg)] hover:opacity-90 transition-opacity"
          >
            <ExternalLink size={13} strokeWidth={2} />
            <span>{t('modal.installAction')}</span>
          </a>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-9 items-center justify-center rounded-full border border-[var(--border)] px-4 text-[12px] font-medium text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors"
        >
          {t('modal.retry')}
        </button>
        {/* When Phantom is internally rejecting (`stale_session` with
            "Unexpected error" — Phantom's catch-all) retry alone is
            futile. Offer the dev-auth bypass as a single-click escape
            so the user isn't stuck. Only rendered when the env flag
            is set; the endpoint hard-404s otherwise. */}
        {onDevSign && isStaleSession && (
          <button
            type="button"
            onClick={() => void onDevSign()}
            className="inline-flex h-9 items-center justify-center rounded-full border border-[var(--border)] px-4 mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-3)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors"
          >
            Dev sign-in (skip wallet) →
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 items-center justify-center px-4 text-[11.5px] text-[var(--fg-3)] hover:text-[var(--fg)] transition-colors"
        >
          {t('close')}
        </button>
      </div>
    </div>
  );
}

function ModalFooter() {
  const t = useTranslations('auth');
  return (
    <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--bg)]/40 rounded-b-2xl">
      <p className="text-[11px] leading-[1.55] text-[var(--fg-3)]">
        {t('modal.footer')}
      </p>
    </div>
  );
}

/* ─────────────── icon renderer ─────────────── */

function WalletIcon({
  icon,
  large = false,
}: {
  icon: IconKind;
  large?: boolean;
}) {
  const size = large ? 56 : 40;
  const sizeClass = large ? 'h-14 w-14' : 'h-10 w-10';
  const roundedClass = large ? 'rounded-2xl' : 'rounded-xl';
  if (icon.kind === 'asset') {
    return (
      <span
        aria-hidden
        className={`block ${sizeClass} overflow-hidden ${roundedClass}`}
      >
        <Image
          src={icon.src}
          alt={icon.alt}
          width={size}
          height={size}
          className={sizeClass}
          unoptimized
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={`flex ${sizeClass} items-center justify-center ${roundedClass} text-white shadow-[inset_0_1px_0_color-mix(in_oklab,white_18%,transparent)]`}
      style={{ background: icon.swatch }}
    >
      {icon.node}
    </span>
  );
}

function MoreGlyph() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <circle cx={6} cy={12} r={1.7} />
      <circle cx={12} cy={12} r={1.7} />
      <circle cx={18} cy={12} r={1.7} />
    </svg>
  );
}

/* ─────────────── helpers ─────────────── */

function installUrlFor(providerId: SolanaProviderId): string | null {
  switch (providerId) {
    case 'phantom':
      return 'https://phantom.app/download';
    case 'solflare':
      return 'https://solflare.com/download';
    case 'more':
      return null;
  }
}

/**
 * Map a CAIP-2 chain identifier to a human-readable label. Used by the
 * `wrong_chain` copy so users see "Solana Devnet" instead of
 * "solana:devnet" in the action title and hint.
 */
function humaniseChain(chain: string | null | undefined): string {
  if (!chain) return '';
  switch (chain) {
    case 'solana:mainnet':
      return 'Solana Mainnet';
    case 'solana:testnet':
      return 'Solana Testnet';
    case 'solana:devnet':
      return 'Solana Devnet';
    default:
      return chain;
  }
}
