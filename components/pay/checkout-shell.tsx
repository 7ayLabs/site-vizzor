'use client';

/**
 * CheckoutShell — top-level client component for /pay/[tier]/[cadence].
 *
 * Orchestrates the payment state machine. Two Phase-1 chains live here:
 *   (1) TON native via TON Connect (lazy-loaded chunk)
 *   (2) Solana-$VIZZOR via the existing Solana wallet adapter (shared
 *       chunk with /predict, zero new bundle cost)
 *
 * The selected (chain, token) pair drives which provider tree mounts +
 * which pay button renders. Either flag enables the route; both flags
 * off renders the "payment infrastructure pending" panel.
 *
 * State machine:
 *   idle → creating → awaiting_wallet → broadcasting → pending
 *        → confirming → confirmed (grant code) → handoff
 *   (any step can error/expire → user can retry)
 */

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { OrderSummary } from './order-summary';
import { ChainSelector, type SelectorValue } from './chain-selector';
import { PaymentStatus, type StatusValue } from './payment-status';
import type {
  PaymentCadence,
  PaymentSession,
  PaymentTier,
  PaymentToken,
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

// Reuse the Solana wallet provider already shipped for /predict. Same
// chunk → zero new dependencies for the $VIZZOR-pay path.
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

export function CheckoutShell({ tier, cadence, priceUsd }: CheckoutShellProps) {
  const t = useTranslations('pay');
  const router = useRouter();
  const [status, setStatus] = useState<StatusValue>('idle');
  const [reason, setReason] = useState<string | undefined>(undefined);
  const [session, setSession] = useState<PaymentSession | null>(null);
  const [selector, setSelector] = useState<SelectorValue>(DEFAULT_SELECTOR);
  const pollAttempts = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tonOn = acceptTonPayments();
  const vizzorOn = acceptVizzorPayments();
  const featureOn = tonOn || vizzorOn;

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
  }, [selector, tonOn, vizzorOn]);

  const onSelectorChange = (next: SelectorValue) => {
    setSelector(next);
    // Reset any in-flight session — new chain/token = new dest address.
    setSession(null);
    setStatus('idle');
    setReason(undefined);
  };

  const createSession = async () => {
    setStatus('creating');
    setReason(undefined);
    try {
      const res = await fetch('/api/payment/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tier,
          cadence,
          chain: selector.chain,
          token: selector.token,
        }),
      });
      const data = (await res.json()) as SessionApiResponse;
      if (!data.ok || !data.session) {
        setStatus('error');
        setReason(data.reason ?? 'session_failed');
        return;
      }
      setSession(data.session);
      setStatus('awaiting_wallet');
    } catch (e) {
      setStatus('error');
      setReason(stringifyError(e));
    }
  };

  const startPolling = (sessionId: string) => {
    pollAttempts.current = 0;
    const tick = async () => {
      pollAttempts.current += 1;
      if (pollAttempts.current > POLL_MAX_ATTEMPTS) {
        setStatus('expired');
        return;
      }
      try {
        const res = await fetch(`/api/payment/session/${sessionId}`);
        const data = (await res.json()) as SessionApiResponse;
        if (data.ok && data.session) {
          setSession(data.session);
          if (data.session.status === 'confirmed' && data.session.grantCode) {
            setStatus('confirmed');
            router.push(`/pay/success?id=${sessionId}`);
            return;
          }
          if (data.session.status === 'confirmed') {
            setStatus('confirming');
          } else if (data.session.status === 'expired') {
            setStatus('expired');
            return;
          } else if (data.session.status === 'failed') {
            setStatus('error');
            setReason('engine_marked_failed');
            return;
          } else {
            setStatus('pending');
          }
        }
      } catch {
        // Transient — keep polling.
      }
      pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS);
    };
    void tick();
  };

  const onSent = (_signature: string) => {
    if (!session) return;
    setStatus('broadcasting');
    startPolling(session.sessionId);
  };

  const onWalletError = (msg: string) => {
    setStatus('error');
    setReason(msg);
  };

  const retry = () => {
    setSession(null);
    setStatus('idle');
    setReason(undefined);
  };

  if (!featureOn) {
    return (
      <PaymentInfraPending tier={tier} cadence={cadence} priceUsd={priceUsd} />
    );
  }

  const payButton: ReactNode = (() => {
    if (!session || status === 'confirmed') {
      return (
        <button
          type="button"
          onClick={createSession}
          disabled={status === 'creating'}
          className="
            inline-flex items-center justify-center gap-2 h-12 px-5 w-full
            text-[13px] font-semibold tracking-tight
            bg-[var(--fg)] text-[var(--bg)]
            disabled:opacity-40 disabled:cursor-not-allowed
            hover:opacity-90 transition-opacity
          "
        >
          <span>
            {status === 'creating' ? t('cta.creating') : t('cta.start')}
          </span>
          <span aria-hidden>→</span>
        </button>
      );
    }
    const disabled =
      status === 'broadcasting' ||
      status === 'pending' ||
      status === 'confirming';
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
          reason={reason}
          retry={status === 'error' || status === 'expired' ? retry : undefined}
        />

        {/* Hide the primary CTA while an error/expired banner is visible
            — the inline Retry button on the status panel is the right
            action and the bottom button would just confuse users. */}
        {status !== 'error' && status !== 'expired' && payButton}

        <p className="mono tabular text-[10px] uppercase tracking-[0.14em] text-[var(--fg-3)] text-center">
          {t('legalFootnote')}
        </p>
      </div>

      <OrderSummary tier={tier} cadence={cadence} token={selector.token} />
    </div>
  );

  // Wrap in the correct provider tree based on selected token. Both
  // providers lazy-load via next/dynamic({ ssr: false }), so only the
  // chunks for the active chain ship.
  if (selector.token === 'vizzor') {
    return <SolanaWalletAdapter>{inner}</SolanaWalletAdapter>;
  }
  return <TonProvider>{inner}</TonProvider>;
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
      <OrderSummary tier={tier} cadence={cadence} token="native" />
    </div>
  );
}

function stringifyError(e: unknown): string {
  if (e instanceof Error) return e.message.slice(0, 160);
  return String(e).slice(0, 160);
}

const _suppressUnusedToken: PaymentToken | undefined = undefined;
void _suppressUnusedToken;
