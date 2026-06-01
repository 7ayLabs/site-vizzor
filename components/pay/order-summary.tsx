/**
 * OrderSummary — left column of the checkout shell.
 *
 * Pure presentation: tier name + cadence label + USD price + a live
 * TON quote that refreshes from /api/payment/rate every ~60s. The
 * actual rate that gets locked into the session is snapshotted on the
 * engine, NOT this one — this preview just exists so the visitor can
 * see roughly how much TON they'll spend before they click pay.
 */

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PaymentCadence, PaymentTier } from '@/lib/payment/session';

interface OrderSummaryProps {
  tier: PaymentTier;
  cadence: PaymentCadence;
  priceUsd: string;
}

interface RateResponse {
  ok: boolean;
  usdPerTon?: number;
  reason?: string;
}

export function OrderSummary({ tier, cadence, priceUsd }: OrderSummaryProps) {
  const t = useTranslations('pay.summary');
  const [rate, setRate] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/payment/rate');
        const data = (await res.json()) as RateResponse;
        if (!cancelled && data.ok && typeof data.usdPerTon === 'number') {
          setRate(data.usdPerTon);
        }
      } catch {
        // ignore — UI shows "rate unavailable"
      } finally {
        if (!cancelled) setRateLoading(false);
      }
    }
    void load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const tonAmount =
    rate !== null
      ? Math.round((parsePriceUsd(priceUsd) / rate) * 100) / 100
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
        <Row label={t('row.subtotal')} value={priceUsd} />
        <Row
          label={t('row.tonQuote')}
          value={
            rateLoading
              ? '…'
              : tonAmount !== null
                ? `~${tonAmount.toFixed(2)} TON`
                : t('row.tonUnavailable')
          }
          mono
        />
        <Row label={t('row.network')} value={t('row.tonMainnet')} />
      </div>

      <div className="border-t border-[var(--border)] pt-4 flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-[var(--fg)]">
          {t('row.total')}
        </span>
        <span className="display text-[22px] font-semibold mono tabular text-[var(--fg)]">
          {priceUsd}
        </span>
      </div>

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
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between text-[12.5px]">
      <span className="text-[var(--fg-3)]">{label}</span>
      <span
        className={`${mono ? 'mono tabular' : ''} text-[var(--fg)]`}
      >
        {value}
      </span>
    </div>
  );
}

function parsePriceUsd(price: string): number {
  // Inputs like "$9.99", "$2,499.00". Strip non-numeric except `.`.
  const cleaned = price.replace(/[^0-9.]/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}
