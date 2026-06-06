/**
 * OrderSummary — left column of the checkout shell.
 *
 * Renders the effective price for the selected (tier, cadence, token)
 * triple. When token is $VIZZOR, shows the base price struck through,
 * the discounted price, and a "you save $X" line. The live rate quote
 * adapts to the selected token via `/api/payment/rate?token=…`.
 */

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
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

export function OrderSummary({ tier, cadence, chain, token }: OrderSummaryProps) {
  const t = useTranslations('pay.summary');
  const [rate, setRate] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(true);

  const tokenParam = token === 'vizzor' ? 'vizzor' : 'ton';

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `/api/payment/rate?token=${tokenParam}`,
        );
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
  }, [tokenParam]);

  const basePriceCents = priceCents(tier, cadence) ?? 0;
  const basePriceLabel = priceUsd(tier, cadence) ?? '$0';
  const effectivePriceLabel =
    effectivePriceUsd(tier, cadence, chain, token) ?? basePriceLabel;
  const effectivePriceUsdNumber = parsePriceUsd(effectivePriceLabel);
  const discountPct = Math.round(
    discountBps(tier, cadence, chain, token) / 100,
  );
  const savedCents = Math.round(basePriceCents - (effectivePriceUsdNumber * 100));
  const savedLabel = `$${(savedCents / 100).toFixed(2)}`;

  const tokenAmount =
    rate !== null
      ? Math.round((effectivePriceUsdNumber / rate) * 100) / 100
      : null;

  return (
    <aside className="border border-[var(--border)] bg-[var(--surface)] p-6 flex flex-col gap-5 h-full">
      <p className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
        {t('label')}
      </p>

      <div className="flex flex-col gap-1">
        <h2 className="text-[20px] font-semibold tracking-tight text-[var(--fg)]">
          {t(`tier.${tier}`)}
        </h2>
        <p className="text-[12.5px] text-[var(--fg-2)]">
          {t(`cadence.${cadence}`)}
        </p>
      </div>

      <div className="border-t border-[var(--border)] pt-4 flex flex-col gap-3">
        <Row label={t('row.subtotal')} value={basePriceLabel} strike={token === 'vizzor'} />
        {token === 'vizzor' && (
          <>
            <Row
              label={t('row.discount', { pct: discountPct })}
              value={`−${savedLabel}`}
              tone="accent"
            />
            <Row
              label={t('row.afterDiscount')}
              value={effectivePriceLabel}
            />
          </>
        )}
        <Row
          label={t(token === 'vizzor' ? 'row.vizzorQuote' : 'row.tonQuote')}
          value={
            rateLoading
              ? '…'
              : tokenAmount !== null
                ? `~${tokenAmount.toFixed(2)} ${token === 'vizzor' ? '$VIZZOR' : 'TON'}`
                : t('row.tokenUnavailable')
          }
          mono
        />
        <Row
          label={t('row.network')}
          value={t(token === 'vizzor' ? 'row.solanaMainnet' : 'row.tonMainnet')}
        />
      </div>

      <div className="border-t border-[var(--border)] pt-4 flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-[var(--fg)]">
          {t('row.total')}
        </span>
        <span className="display text-[22px] font-semibold mono tabular text-[var(--fg)]">
          {effectivePriceLabel}
        </span>
      </div>

      {token === 'vizzor' && savedCents > 0 && (
        <p className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--accent)]">
          {t('row.savedWithVizzor', { amount: savedLabel })}
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
}: {
  label: string;
  value: string;
  mono?: boolean;
  strike?: boolean;
  tone?: 'default' | 'accent';
}) {
  const valueColor =
    tone === 'accent' ? 'text-[var(--accent)]' : 'text-[var(--fg)]';
  return (
    <div className="flex items-baseline justify-between text-[12.5px]">
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
