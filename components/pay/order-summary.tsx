/**
 * OrderSummary — sidebar of the checkout shell.
 *
 * Renders the effective price (base − chain discount), the live token
 * quote, and a "you save $X" line. The quote token + display label
 * adapt to the selected chain × token pair.
 *
 * Subtle animation: when the chain / token changes, the changed rows
 * cross-fade so the user feels the recalc without it being jarring.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { gsap } from 'gsap';
import type {
  PaymentCadence,
  PaymentChain,
  PaymentTier,
  PaymentToken,
} from '@/lib/payment/session';
import {
  effectivePriceUsd,
  priceCents,
  priceUsd,
  discountBps,
} from '@/lib/payment/pricing-table';
import type { ChainIconId } from './chain-icons';
import { ChainOptionIcon } from './chain-option-icon';
import {
  isNonProd,
  networkBadgeLabel,
  networkLabel as networkLabelFor,
} from '@/lib/payment/network';

interface OrderSummaryProps {
  tier: PaymentTier;
  cadence: PaymentCadence;
  chain: PaymentChain;
  token: PaymentToken;
}

interface RateResponse {
  ok: boolean;
  usdPer?: number;
  reason?: string;
}

// `token` is now always 'native' (USDC was removed in v0.4). The
// parameter stays in the signatures so the future re-introduction of a
// non-native rail re-enters at the same call sites with one
// discriminator added — no plumbing churn.
function priceToken(chain: PaymentChain, _token: PaymentToken): 'sol' | 'ton' {
  if (chain === 'ton') return 'ton';
  return 'sol';
}

function networkLabel(chain: PaymentChain): string {
  return networkLabelFor(chain);
}

function iconConfig(
  chain: PaymentChain,
  _token: PaymentToken,
): { primary: ChainIconId; networkBadge?: ChainIconId } {
  if (chain === 'ton') return { primary: 'ton' };
  return { primary: 'solana' };
}

function quoteSymbol(chain: PaymentChain, _token: PaymentToken): string {
  if (chain === 'ton') return 'TON';
  return 'SOL';
}

export function OrderSummary({ tier, cadence, chain, token }: OrderSummaryProps) {
  const t = useTranslations('pay.summary');
  const [rate, setRate] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(true);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const ptoken = priceToken(chain, token);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/payment/rate?token=${ptoken}`);
        const data = (await res.json()) as RateResponse;
        if (!cancelled && data.ok && typeof data.usdPer === 'number') {
          setRate(data.usdPer);
        } else if (!cancelled) {
          setRate(null);
        }
      } catch {
        if (!cancelled) setRate(null);
      } finally {
        if (!cancelled) setRateLoading(false);
      }
    }
    setRateLoading(true);
    void load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [ptoken]);

  // Animate the summary on chain / token change. Quick fade-in flip
  // gives the user a tactile cue that the totals just recalced.
  useEffect(() => {
    if (!cardRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.fromTo(
      cardRef.current.querySelectorAll('[data-recalc]'),
      { opacity: 0.4, y: 4 },
      { opacity: 1, y: 0, duration: 0.28, ease: 'power2.out', stagger: 0.03 },
    );
  }, [chain, token, rate]);

  const basePriceCents = priceCents(tier, cadence) ?? 0;
  const basePriceLabel = priceUsd(tier, cadence) ?? '$0';
  const effectivePriceLabel =
    effectivePriceUsd(tier, cadence, chain, token) ?? basePriceLabel;
  const effectivePriceUsdNumber = parsePriceUsd(effectivePriceLabel);
  const discountPct = Math.round(
    discountBps(tier, cadence, chain, token) / 100,
  );
  const savedCents = Math.round(basePriceCents - effectivePriceUsdNumber * 100);
  const savedLabel = `$${(savedCents / 100).toFixed(2)}`;

  const tokenAmount =
    rate !== null
      ? Math.round((effectivePriceUsdNumber / rate) * 10000) / 10000
      : null;
  const hasDiscount = discountPct > 0;

  const symbol = quoteSymbol(chain, token);
  // Native SOL and TON both render at 4-decimal precision (sub-cent
  // for prices under ~$100). When USDC returns, branch here on token.
  const tokenAmountLabel = rateLoading
    ? '…'
    : tokenAmount !== null
      ? `${tokenAmount.toFixed(4)} ${symbol}`
      : t('row.tokenUnavailable');

  return (
    <aside
      ref={cardRef}
      className="
        relative border border-[var(--border)] bg-[var(--surface)]
        p-5 flex flex-col gap-5 rounded-2xl
        lg:sticky lg:top-20 h-fit
      "
    >
      <div className="flex items-center justify-between">
        <p className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
          {t('label')}
        </p>
        {isNonProd() && (
          <span
            className="
              rounded-md px-1.5 py-0.5
              mono tabular text-[9.5px] uppercase tracking-[0.18em]
              border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-2)]
            "
          >
            {networkBadgeLabel()}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <ChainOptionIcon
          primary={iconConfig(chain, token).primary}
          networkBadge={iconConfig(chain, token).networkBadge}
          size={44}
        />
        <span className="flex flex-col min-w-0">
          <span className="text-[16px] font-semibold tracking-tight text-[var(--fg)] truncate">
            {t(`tier.${tier}`)}
          </span>
          <span className="mono tabular text-[11px] text-[var(--fg-3)] truncate">
            {networkLabel(chain)}
          </span>
        </span>
      </div>

      <div className="flex items-end justify-between pt-5 border-t border-[var(--border)]">
        <div className="flex flex-col gap-1">
          <span className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
            {t('row.total')}
          </span>
          {hasDiscount && (
            <span className="mono tabular text-[12px] text-[var(--fg-3)] line-through">
              {basePriceLabel}
            </span>
          )}
        </div>
        <span
          data-recalc
          className="text-[40px] sm:text-[44px] font-semibold tracking-tight mono tabular text-[var(--fg)] leading-none"
        >
          {effectivePriceLabel}
        </span>
      </div>

      <div
        data-recalc
        className="flex items-baseline justify-between text-[13px]"
      >
        <span className="text-[var(--fg-3)]">{symbol}</span>
        <span className="mono tabular text-[var(--fg)]">
          ≈ {tokenAmountLabel}
        </span>
      </div>

      {hasDiscount && savedCents > 0 && (
        <p
          data-recalc
          className="
            mono tabular text-[10.5px] uppercase tracking-[0.16em] text-[var(--fg-2)] text-center
            border border-[var(--border)] bg-[var(--surface-2)]
            py-2 rounded-lg
          "
        >
          {t('row.savedWithChain', { amount: savedLabel, token: symbol })}
        </p>
      )}

      <p className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)] text-center">
        {t('footnote')}
      </p>
    </aside>
  );
}

function parsePriceUsd(price: string): number {
  const cleaned = price.replace(/[^0-9.]/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}
