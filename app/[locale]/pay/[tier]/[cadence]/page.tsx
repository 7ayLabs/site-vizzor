/**
 * /[locale]/pay/[tier]/[cadence] — checkout shell.
 *
 * Server shell: validates the URL params against the canonical pricing
 * table (rejects invalid combos like /pay/free/lifetime → 404),
 * resolves the display price + i18n, mounts the client checkout.
 */

import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { CheckoutShell } from '@/components/pay/checkout-shell';
import { isValidCombo, priceUsd } from '@/lib/payment/pricing-table';
import type { PaymentCadence, PaymentTier } from '@/lib/payment/session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; tier: string; cadence: string }>;
}): Promise<Metadata> {
  const { locale, tier, cadence } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pay');
  return {
    title: t('meta.title', { tier, cadence }),
    description: t('meta.description'),
  };
}

export default async function PayPage({
  params,
}: {
  params: Promise<{ locale: string; tier: string; cadence: string }>;
}) {
  const { locale, tier, cadence } = await params;
  setRequestLocale(locale);

  if (!isValidCombo(tier, cadence)) {
    notFound();
  }

  const display = priceUsd(tier as PaymentTier, cadence as PaymentCadence);
  if (!display) notFound();

  return (
    <section className="relative">
      <div className="mx-auto max-w-[1040px] px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <CheckoutShell
          tier={tier as PaymentTier}
          cadence={cadence as PaymentCadence}
          priceUsd={display}
        />
      </div>
    </section>
  );
}
