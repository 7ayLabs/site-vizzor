'use client';

/**
 * CheckoutShell — top-level client component for /pay/[tier]/[cadence].
 *
 * Four live rails: SOL on Solana (native on-site), TON / USDC-Base /
 * USDC-Arbitrum (session created locally, payment redirected into
 * the Telegram bot which owns the wallet flow there). The bot writes
 * back to the same subscriptions / wallet_links tables.
 *
 * Every state mutation goes through the `next()` reducer — the
 * component never assigns to the state setter directly. The reducer
 * guarantees we cannot enter an invalid composition (e.g. a "done"
 * state without a grant code, or a "paying" state with no session).
 *
 * Animation: GSAP entrance for the title block + status banner; CSS
 * transitions on every button hover and the active chain swap.
 */

import dynamic from 'next/dynamic';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { gsap } from 'gsap';
import { useRouter } from '@/i18n/navigation';
import { OrderSummary } from './order-summary';
import { ChainSelector, type SelectorValue } from './chain-selector';
import { PaymentStatus, type StatusValue } from './payment-status';
import { TelegramHandoffButton } from './telegram-handoff-button';
import {
  ctaHidden,
  initial,
  isRecoverable,
  next,
  sessionOf,
  type PurchaseEvent,
  type PurchaseState,
} from './purchase-state';
import type {
  PaymentCadence,
  PaymentChain,
  PaymentSession,
  PaymentTier,
} from '@/lib/payment/session';
import { acceptSolanaPayments } from '@/lib/feature-flags';

const SolanaWalletAdapter = dynamic(
  () => import('@/components/wallet/wallet-provider'),
  { ssr: false, loading: () => null },
);

const SolanaPayButton = dynamic(
  () => import('./solana-pay-button').then((m) => m.SolanaPayButton),
  { ssr: false, loading: () => null },
);

const WalletPickerPanel = dynamic(
  () => import('./wallet-picker-panel').then((m) => m.WalletPickerPanel),
  { ssr: false, loading: () => null },
);

interface CheckoutShellProps {
  tier: PaymentTier;
  cadence: PaymentCadence;
  priceUsd: string;
}

interface SessionApiResponse {
  ok: boolean;
  session?: PaymentSession;
  reason?: string;
}

// 5s matches the Solana watcher's own poll cadence — quicker than that
// just generates redundant requests against an unchanged session row.
const POLL_INTERVAL_MS = 5_000;
// 120 attempts × 5s = 10 minutes wall clock (matches the session TTL).
const POLL_MAX_ATTEMPTS = 120;

const DEFAULT_SELECTOR: SelectorValue = { chain: 'solana', token: 'native' };

function asStatusValue(kind: PurchaseState['kind']): StatusValue {
  return kind;
}

function chainLabel(chain: PaymentChain): string {
  if (chain === 'ton') return 'TON';
  return 'Solana';
}

export function CheckoutShell({ tier, cadence, priceUsd }: CheckoutShellProps) {
  const t = useTranslations('pay');
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, undefined, initial);
  const selectorRef = useRef<SelectorValue>(DEFAULT_SELECTOR);
  const headerRef = useRef<HTMLElement | null>(null);
  const pollAttempts = useRef(0);

  const [selector, setSelector] = useReducerSelector(DEFAULT_SELECTOR);

  const featureOn = acceptSolanaPayments();

  selectorRef.current = selector;

  // Header entrance — eyebrow + title + sub slide up + fade in.
  useEffect(() => {
    if (!headerRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.fromTo(
      headerRef.current.children,
      { opacity: 0, y: 14 },
      {
        opacity: 1,
        y: 0,
        duration: 0.45,
        ease: 'power2.out',
        stagger: 0.08,
      },
    );
  }, []);

  useEffect(() => {
    if (state.kind === 'done') {
      router.push(`/pay/success?id=${state.session.sessionId}`);
    }
  }, [state, router]);

  const onSelectorChange = useCallback(
    (nextValue: SelectorValue) => {
      setSelector(nextValue);
      dispatch({ type: 'reset' });
    },
    [setSelector],
  );

  const createSession = useCallback(async () => {
    dispatch({ type: 'start' });
    try {
      const res = await fetch('/api/payment/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tier,
          cadence,
          chain: selectorRef.current.chain,
          token: selectorRef.current.token,
        }),
      });
      // Defensive parse: a module-load throw or a non-Next-handled
      // 500 returns plain text ("Internal Server Error") and the old
      // unconditional `.json()` was throwing on that body — the
      // catch fell through and the user saw a generic 'Something
      // went wrong' chip with no actionable cause. Read as text
      // first, attempt JSON parse, fall back to surfacing the raw
      // status + first line of the body when JSON parsing fails.
      const raw = await res.text();
      type ParsedResponse = SessionApiResponse & { message?: string };
      let data: ParsedResponse | null = null;
      try {
        data = raw ? (JSON.parse(raw) as ParsedResponse) : null;
      } catch {
        // Non-JSON body — surface the HTTP status + first line.
        const head = raw.split('\n')[0]?.slice(0, 200) ?? '';
        dispatch({
          type: 'session-create-failed',
          reason: `http_${res.status}${head ? `: ${head}` : ''}`,
        });
        return;
      }
      if (!res.ok || !data || !data.ok || !data.session) {
        // Prefer the structured message field when the server set it
        // (e.g. payment_misconfigured carries the missing env names);
        // fall back to `reason`, then to a generic placeholder.
        const reason =
          data?.message ?? data?.reason ?? `http_${res.status}`;
        dispatch({ type: 'session-create-failed', reason });
        return;
      }
      dispatch({ type: 'session-created', session: data.session });
    } catch (e) {
      dispatch({
        type: 'session-create-failed',
        reason: stringifyError(e),
      });
    }
  }, [tier, cadence]);

  // Poll the session row only while we're in `paying`. The effect is
  // keyed on `(state.kind === 'paying', sessionId)` rather than the
  // full state object so a `poll-update` dispatch that mutates state
  // does NOT tear down + re-arm the loop — that previous shape caused
  // a runaway request storm (each tick triggered a re-render which
  // re-ran the effect which started a fresh tick on top of the one
  // already in flight).
  const isPaying = state.kind === 'paying';
  const payingSessionId = isPaying ? state.session.sessionId : null;

  useEffect(() => {
    if (!isPaying || !payingSessionId) return;

    let cancelled = false;
    let attempts = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let etag: string | null = null;
    pollAttempts.current = 0;

    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      pollAttempts.current = attempts;
      if (attempts > POLL_MAX_ATTEMPTS) {
        dispatch({ type: 'poll-expired' });
        return;
      }
      try {
        const res = await fetch(`/api/payment/session/${payingSessionId}`, {
          cache: 'no-store',
          headers: etag ? { 'if-none-match': etag } : undefined,
        });
        if (cancelled) return;

        // 304 — server says the row is unchanged. No body, no dispatch.
        // Just re-arm. This is the hot path: the watcher hasn't seen
        // the on-chain tx yet, so 95% of polls land here.
        if (res.status === 304) {
          const nextEtag = res.headers.get('etag');
          if (nextEtag) etag = nextEtag;
        } else {
          const data = (await res.json()) as SessionApiResponse;
          if (cancelled) return;
          // Capture ETag for the NEXT request.
          const nextEtag = res.headers.get('etag');
          if (nextEtag) etag = nextEtag;
          if (data.ok && data.session) {
            dispatch({ type: 'poll-update', session: data.session });
            if (
              data.session.status === 'confirmed' ||
              data.session.status === 'expired' ||
              data.session.status === 'failed'
            ) {
              return;
            }
          } else if (!data.ok) {
            dispatch({
              type: 'poll-error',
              reason: data.reason ?? 'session_failed',
            });
            return;
          }
        }
      } catch {
        // Transient (network blip / dev HMR) — keep polling.
      }
      if (cancelled) return;
      timeoutId = setTimeout(tick, POLL_INTERVAL_MS);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isPaying, payingSessionId]);

  const onSent = useCallback((signature: string) => {
    dispatch({ type: 'tx-signed', txSig: signature });
  }, []);

  const onWalletError = useCallback((msg: string) => {
    dispatch({ type: 'wallet-error', reason: msg });
  }, []);

  const retry = useCallback(() => {
    // The polling effect's own cleanup tears down the in-flight loop
    // as soon as `state.kind` transitions out of `paying` after reset.
    dispatch({ type: 'reset' });
  }, []);

  const session = sessionOf(state);
  const status: StatusValue = asStatusValue(state.kind);
  const reasonForBanner = useMemo<string | undefined>(() => {
    if (state.kind === 'error') return state.reason;
    return undefined;
  }, [state]);

  if (!featureOn) {
    return (
      <PaymentInfraPending tier={tier} cadence={cadence} priceUsd={priceUsd} />
    );
  }

  const isSolana = selector.chain === 'solana' && selector.token === 'native';

  const payButton: ReactNode = (() => {
    if (!session) {
      return (
        <button
          type="button"
          onClick={createSession}
          disabled={state.kind === 'connecting'}
          className="
            group relative inline-flex items-center justify-center gap-2 h-12 px-5 w-full
            rounded-xl text-[13px] font-semibold tracking-tight
            bg-[var(--fg)] text-[var(--bg)]
            transition-[transform,opacity,box-shadow] duration-200 ease-out
            shadow-[0_8px_28px_-14px_rgba(0,0,0,0.45)]
            disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
            motion-safe:enabled:hover:-translate-y-[1px]
            enabled:hover:opacity-95
          "
        >
          <span>
            {state.kind === 'connecting' ? t('cta.creating') : t('cta.start')}
          </span>
          <span
            aria-hidden
            className="transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-0.5"
          >
            →
          </span>
        </button>
      );
    }

    const disabled =
      state.kind === 'paying' ||
      state.kind === 'confirming' ||
      state.kind === 'connecting';

    if (isSolana) {
      return (
        <SolanaPayButton
          destAddress={session.destAddress}
          amount={session.amount}
          sessionId={session.sessionId}
          onSent={onSent}
          onError={onWalletError}
          disabled={disabled}
        />
      );
    }

    return (
      <TelegramHandoffButton
        sessionId={session.sessionId}
        chainLabel={chainLabel(selector.chain)}
        disabled={disabled}
      />
    );
  })();

  const inner = (
    <div className="mx-auto w-full max-w-[1100px] grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8 pt-6 sm:pt-10">
      <div className="flex flex-col gap-6">
        <header ref={headerRef} className="flex flex-col gap-3">
          <p className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
            {t(`summary.cadence.${cadence}`)}
          </p>
          <h1 className="display text-[var(--fg)] text-[32px] sm:text-[40px] lg:text-[44px] leading-[1.05] tracking-tight font-semibold text-balance">
            {t('title', { tier: t(`summary.tier.${tier}`) })}
          </h1>
          <p className="text-[14px] leading-relaxed text-[var(--fg-2)] max-w-[60ch]">
            {t('sub')}
          </p>
        </header>

        <ChainSelector
          value={selector}
          onChange={onSelectorChange}
          tier={tier}
          cadence={cadence}
        />

        <PaymentStatus
          status={status}
          reason={reasonForBanner}
          retry={isRecoverable(state) ? retry : undefined}
          tier={tier}
          cadence={cadence}
        />

        {isSolana && session && <WalletPickerPanel />}

        {!ctaHidden(state) && payButton}

        <p className="mono tabular text-[9.5px] uppercase tracking-[0.14em] text-[var(--fg-3)] text-center">
          {t('legalFootnote')}
        </p>
      </div>

      <OrderSummary
        tier={tier}
        cadence={cadence}
        chain={selector.chain}
        token={selector.token}
      />
    </div>
  );

  if (isSolana) {
    // autoConnect=true so the wallet picked during the navbar SIWS
    // flow is silently restored when the user arrives on /pay. The
    // RPC fallback chain is browser-friendly (PublicNode mainnet,
    // devnet for testnet) so the on-mount blockhash fetch the adapter
    // performs no longer 403s the way mainnet-beta did.
    return (
      <SolanaWalletAdapter autoConnect={true}>{inner}</SolanaWalletAdapter>
    );
  }
  return inner;
}

function reducer(state: PurchaseState, event: PurchaseEvent): PurchaseState {
  return next(state, event);
}

function useReducerSelector(
  init: SelectorValue,
): readonly [SelectorValue, (s: SelectorValue) => void] {
  const [s, dispatch] = useReducer(
    (_prev: SelectorValue, next: SelectorValue) => next,
    init,
  );
  return [s, dispatch];
}

function PaymentInfraPending({
  tier,
  cadence,
  priceUsd: _priceUsd,
}: {
  tier: PaymentTier;
  cadence: PaymentCadence;
  priceUsd: string;
}) {
  const t = useTranslations('pay');
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
      <div className="border border-[var(--border)] bg-[var(--surface)] p-6 flex flex-col gap-4 rounded-xl">
        <p className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
          {t('pending.label')}
        </p>
        <h1 className="display text-[var(--fg)] text-[26px] sm:text-[30px] leading-[1.05] tracking-tight font-semibold">
          {t('pending.title')}
        </h1>
        <p className="text-[14px] leading-relaxed text-[var(--fg-2)] max-w-[60ch]">
          {t('pending.body')}
        </p>
        <a
          href={`https://t.me/vizzorai_bot?start=pay_${tier}_${cadence}`}
          target="_blank"
          rel="noopener"
          className="
            inline-flex items-center justify-center gap-2 h-11 px-4 w-fit
            rounded-xl text-[13px] font-semibold tracking-tight
            bg-[var(--fg)] text-[var(--bg)]
            transition-[transform,opacity] duration-200 ease-out
            motion-safe:hover:-translate-y-[1px] hover:opacity-95
          "
        >
          <span>{t('pending.telegramCta')}</span>
          <span aria-hidden>→</span>
        </a>
      </div>
      <OrderSummary
        tier={tier}
        cadence={cadence}
        chain="solana"
        token="native"
      />
    </div>
  );
}

function stringifyError(e: unknown): string {
  if (e instanceof Error) return e.message.slice(0, 160);
  return String(e).slice(0, 160);
}
