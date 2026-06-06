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

function priceToken(chain: PaymentChain, token: PaymentToken): 'sol' | 'ton' | 'usdc' {
  if (token === 'usdc') return 'usdc';
  if (chain === 'ton') return 'ton';
  return 'sol';
}

function networkLabel(chain: PaymentChain): string {
  switch (chain) {
    case 'solana':
      return 'Solana mainnet';
    case 'ton':
      return 'TON mainnet';
    case 'base':
      return 'Base mainnet';
    case 'arbitrum':
      return 'Arbitrum One';
  }
}

function iconConfig(
  chain: PaymentChain,
  token: PaymentToken,
): { primary: ChainIconId; networkBadge?: ChainIconId } {
  if (token === 'usdc') {
    return { primary: 'usdc', networkBadge: chain as ChainIconId };
  }
  if (chain === 'ton') return { primary: 'ton' };
  return { primary: 'solana' };
}

function quoteSymbol(chain: PaymentChain, token: PaymentToken): string {
  if (token === 'usdc') return 'USDC';
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

  return (
    <aside
      ref={cardRef}
      className="
        relative border border-[var(--border)] bg-[var(--surface)]
        p-6 flex flex-col gap-5 h-full rounded-xl
        shadow-[0_1px_0_color-mix(in_oklab,white_4%,transparent),0_20px_40px_-24px_rgba(0,0,0,0.4)]
      "
    >
      <div className="flex items-center justify-between">
        <p className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
          {t('label')}
        </p>
        <ChainOptionIcon
          primary={iconConfig(chain, token).primary}
          networkBadge={iconConfig(chain, token).networkBadge}
          size={32}
        />
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="text-[20px] font-semibold tracking-tight text-[var(--fg)]">
          {t(`tier.${tier}`)}
        </h2>
        <p className="text-[12.5px] text-[var(--fg-2)]">
          {t(`cadence.${cadence}`)}
        </p>
      </div>

      <div className="border-t border-[var(--border)] pt-4 flex flex-col gap-3">
        <Row
          label={t('row.subtotal')}
          value={basePriceLabel}
          strike={hasDiscount}
        />
        {hasDiscount && (
          <>
            <Row
              data-recalc
              label={t('row.discount', { pct: discountPct })}
              value={`−${savedLabel}`}
              tone="accent"
            />
            <Row
              data-recalc
              label={t('row.afterDiscount')}
              value={effectivePriceLabel}
            />
          </>
        )}
        <Row
          data-recalc
          label={t('row.tokenQuote', { token: quoteSymbol(chain, token) })}
          value={
            rateLoading
              ? '…'
              : tokenAmount !== null
                ? `~${tokenAmount.toFixed(token === 'usdc' ? 2 : 4)} ${quoteSymbol(chain, token)}`
                : t('row.tokenUnavailable')
          }
          mono
        />
        <Row
          data-recalc
          label={t('row.network')}
          value={networkLabel(chain)}
        />
      </div>

      <div className="border-t border-[var(--border)] pt-4 flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-[var(--fg)]">
          {t('row.total')}
        </span>
        <span
          data-recalc
          className="text-[28px] sm:text-[32px] font-semibold tracking-tight mono tabular text-[var(--fg)] leading-none"
        >
          {effectivePriceLabel}
        </span>
      </div>

      {hasDiscount && savedCents > 0 && (
        <p
          data-recalc
          className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--accent)]"
        >
          {t('row.savedWithChain', {
            amount: savedLabel,
            token: quoteSymbol(chain, token),
          })}
        </p>
      )}

      <p className="mono tabular text-[9.5px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
        {t('footnote')}
      </p>
    </aside>
  );
}

function Row({
  label,
  value,
  mono = false,
  strike = false,
  tone = 'default',
  ...rest
}: {
  label: string;
  value: string;
  mono?: boolean;
  strike?: boolean;
  tone?: 'default' | 'accent';
  ['data-recalc']?: boolean;
}) {
  const valueColor =
    tone === 'accent' ? 'text-[var(--accent)]' : 'text-[var(--fg)]';
  return (
    <div
      {...rest}
      className="flex items-baseline justify-between text-[12.5px]"
    >
      <span className="text-[var(--fg-3)]">{label}</span>
      <span
        className={`${mono ? 'mono tabular' : ''} ${valueColor} ${strike ? 'line-through opacity-60' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

function parsePriceUsd(price: string): number {
  const cleaned = price.replace(/[^0-9.]/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}
