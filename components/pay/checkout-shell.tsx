'use client';

/**
 * CheckoutShell — top-level client component for /pay/[tier]/[cadence].
 *
 * Orchestrates the payment state machine defined in `purchase-state.ts`.
 * Two Phase-1 chains live here:
 *   (1) TON native via TON Connect (lazy-loaded chunk)
 *   (2) Solana-$VIZZOR via the existing Solana wallet adapter (shared
 *       chunk with /predict, zero new bundle cost)
 *
 * The selected (chain, token) pair drives which provider tree mounts +
 * which pay button renders. Either flag enables the route; both flags
 * off renders the "payment infrastructure pending" panel.
 *
 * Every state mutation goes through the `next()` reducer — the
 * component never assigns to the state setter directly. The reducer
 * guarantees we cannot enter an invalid composition (e.g. a "done"
 * state without a grant code, or a "paying" state with no session).
 * The renderer's `switch (state.kind)` enforces exhaustiveness at
 * compile time.
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
import { useRouter } from '@/i18n/navigation';
import { OrderSummary } from './order-summary';
import { ChainSelector, type SelectorValue } from './chain-selector';
import { PaymentStatus, type StatusValue } from './payment-status';
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
  PaymentSession,
  PaymentTier,
} from '@/lib/payment/session';
import {
  acceptTonPayments,
  acceptVizzorPayments,
} from '@/lib/feature-flags';

const TonProvider = dynamic(
  () => import('./ton-provider').then((m) => m.TonProvider),
  { ssr: false, loading: () => null },
);

const TonConnectButton = dynamic(
  () => import('./ton-connect-button').then((m) => m.TonConnectButton),
  { ssr: false, loading: () => null },
);

const SolanaWalletAdapter = dynamic(
  () => import('@/components/wallet/wallet-provider'),
  { ssr: false, loading: () => null },
);

const VizzorPayButton = dynamic(
  () => import('./vizzor-pay-button').then((m) => m.VizzorPayButton),
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

const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS = 200; // ~10 min wall clock

const DEFAULT_SELECTOR: SelectorValue = { chain: 'ton', token: 'native' };

/**
 * Maps the discriminated-union state.kind to the presentational
 * `StatusValue` consumed by PaymentStatus. They are mostly the same
 * but PaymentStatus stays presentational and re-usable independently
 * of the reducer.
 */
function asStatusValue(kind: PurchaseState['kind']): StatusValue {
  // Tail-end identity for: idle, connecting, signing, confirming,
  // expired, error, done. The 'paying' state maps to 'paying'
  // directly; 'wrong-network' maps 1:1.
  return kind;
}

export function CheckoutShell({ tier, cadence, priceUsd }: CheckoutShellProps) {
  const t = useTranslations('pay');
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, undefined, initial);
  const selectorRef = useRef<SelectorValue>(DEFAULT_SELECTOR);
  const pollAttempts = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Selector lives in a ref + effect-driven state so the reducer
  // remains pure. The selector is presentational config — the
  // reducer cares only about the session it produces.
  const [selector, setSelector] = useReducerSelector(DEFAULT_SELECTOR);

  const tonOn = acceptTonPayments();
  const vizzorOn = acceptVizzorPayments();
  const featureOn = tonOn || vizzorOn;

  selectorRef.current = selector;

  // Cleanup polling on unmount.
  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  // If the user picks a chain whose flag is off, snap back to a flag-on
  // option to avoid a dead-end UI.
  useEffect(() => {
    if (selector.chain === 'ton' && !tonOn && vizzorOn) {
      setSelector({ chain: 'solana', token: 'vizzor' });
    } else if (selector.chain === 'solana' && !vizzorOn && tonOn) {
      setSelector(DEFAULT_SELECTOR);
    }
  }, [selector, tonOn, vizzorOn, setSelector]);

  // Side-effect: on `done`, redirect to the success page so the grant
  // handoff card renders with full SSR (and shareable URL).
  useEffect(() => {
    if (state.kind === 'done') {
      router.push(`/pay/success?id=${state.session.sessionId}`);
    }
  }, [state, router]);

  const onSelectorChange = useCallback(
    (nextValue: SelectorValue) => {
      setSelector(nextValue);
      // New chain/token = new dest address. Drop any in-flight state.
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
      const data = (await res.json()) as SessionApiResponse;
      if (!data.ok || !data.session) {
        dispatch({
          type: 'session-create-failed',
          reason: data.reason ?? 'session_failed',
        });
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

  const startPolling = useCallback((sessionId: string) => {
    pollAttempts.current = 0;
    const tick = async () => {
      pollAttempts.current += 1;
      if (pollAttempts.current > POLL_MAX_ATTEMPTS) {
        dispatch({ type: 'poll-expired' });
        return;
      }
      try {
        const res = await fetch(`/api/payment/session/${sessionId}`);
        const data = (await res.json()) as SessionApiResponse;
        if (data.ok && data.session) {
          dispatch({ type: 'poll-update', session: data.session });
          // The reducer decides whether to stop — done/expired/error
          // are terminal. We always re-arm the timer; the next tick
          // is a no-op against terminal state because dispatch will
          // be ignored. But to avoid wasting requests, check kind.
        } else if (!data.ok) {
          // Hard failure on the poll path.
          dispatch({
            type: 'poll-error',
            reason: data.reason ?? 'session_failed',
          });
          return;
        }
      } catch {
        // Transient — keep polling.
      }
      pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS);
    };
    void tick();
  }, []);

  // Kick off polling when we enter `paying` (the wallet has signed).
  useEffect(() => {
    if (state.kind === 'paying') {
      const session = state.session;
      startPolling(session.sessionId);
      return () => {
        if (pollTimer.current) clearTimeout(pollTimer.current);
      };
    }
    return undefined;
  }, [state, startPolling]);

  const onSent = useCallback((signature: string) => {
    dispatch({ type: 'tx-signed', txSig: signature });
  }, []);

  const onWalletError = useCallback((msg: string) => {
    dispatch({ type: 'wallet-error', reason: msg });
  }, []);

  const retry = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
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

  const payButton: ReactNode = (() => {
    // No session yet, or terminal state with a fresh retry available
    // → show the primary "Start payment" CTA.
    if (!session) {
      return (
        <button
          type="button"
          onClick={createSession}
          disabled={state.kind === 'connecting'}
          className="
            inline-flex items-center justify-center gap-2 h-12 px-5 w-full
            text-[13px] font-semibold tracking-tight
            bg-[var(--fg)] text-[var(--bg)]
            disabled:opacity-40 disabled:cursor-not-allowed
            hover:opacity-90 transition-opacity
          "
        >
          <span>
            {state.kind === 'connecting' ? t('cta.creating') : t('cta.start')}
          </span>
          <span aria-hidden>→</span>
        </button>
      );
    }

    const disabled =
      state.kind === 'paying' ||
      state.kind === 'confirming' ||
      state.kind === 'connecting';

    if (selector.token === 'vizzor') {
      return (
        <VizzorPayButton
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
      <TonConnectButton
        destAddress={session.destAddress}
        amountTon={session.amount}
        sessionId={session.sessionId}
        onSent={onSent}
        onError={onWalletError}
        disabled={disabled}
      />
    );
  })();

  const inner = (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 pt-4 sm:pt-6">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <p className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
            {selector.token === 'vizzor'
              ? t('eyebrowVizzor')
              : t('eyebrow')}
          </p>
          <h1 className="display text-[var(--fg)] text-[28px] sm:text-[34px] lg:text-[38px] leading-[1.1] tracking-tight font-semibold text-balance">
            {t('title', { tier: t(`summary.tier.${tier}`) })}
          </h1>
          <p className="text-[14px] leading-relaxed text-[var(--fg-2)] max-w-[60ch]">
            {selector.token === 'vizzor' ? t('subVizzor') : t('sub')}
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

        {/* The status banner owns the CTA when it carries a Retry. */}
        {!ctaHidden(state) && payButton}

        <p className="mono tabular text-[10px] uppercase tracking-[0.14em] text-[var(--fg-3)] text-center">
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

  if (selector.token === 'vizzor') {
    return <SolanaWalletAdapter>{inner}</SolanaWalletAdapter>;
  }
  return <TonProvider>{inner}</TonProvider>;
}

/* ────────────── reducer thin wrapper ────────────── */

function reducer(state: PurchaseState, event: PurchaseEvent): PurchaseState {
  return next(state, event);
}

/* ────────────── selector mini-hook ────────────── */

function useReducerSelector(
  init: SelectorValue,
): readonly [SelectorValue, (s: SelectorValue) => void] {
  const [s, dispatch] = useReducer(
    (_prev: SelectorValue, next: SelectorValue) => next,
    init,
  );
  return [s, dispatch];
}

/* ────────────── infra-pending panel (unchanged) ────────────── */

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
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
      <div className="border border-[var(--border)] bg-[var(--surface)] p-6 flex flex-col gap-4">
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
            text-[13px] font-semibold tracking-tight
            bg-[var(--fg)] text-[var(--bg)] hover:opacity-90
          "
        >
          <span>{t('pending.telegramCta')}</span>
          <span aria-hidden>→</span>
        </a>
      </div>
      <OrderSummary tier={tier} cadence={cadence} chain="ton" token="native" />
    </div>
  );
}

function stringifyError(e: unknown): string {
  if (e instanceof Error) return e.message.slice(0, 160);
  return String(e).slice(0, 160);
}
