/**
 * /[locale]/app/billing — payment history surface.
 *
 * Read-only view of confirmed on-chain payments for the active wallet.
 * The list itself fetches client-side (`PaymentHistoryList`) so it
 * stays live across re-renders + tab-foreground events; the page shell
 * is server-rendered for fast first paint and SEO neutrality (the
 * surface is wallet-gated so search engines never see the list).
 */

import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { PaymentHistoryList } from '@/components/app/payment-history-list';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('app.billing');
  return {
    title: t('meta.title'),
    description: t('meta.description'),
  };
}

export default async function BillingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('app.billing');

  return (
    <div className="mx-auto w-full max-w-[840px] px-6 py-12">
      <header className="mb-8">
        <p className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--accent)]">
          {t('eyebrow')}
        </p>
        <h1 className="mt-1 display text-[28px] sm:text-[32px] leading-tight tracking-tight font-semibold text-[var(--fg)]">
          {t('title')}
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-[var(--fg-2)] max-w-[64ch]">
          {t('body')}
        </p>
      </header>

      <section className="border border-[var(--border)] bg-[var(--surface)] rounded-2xl p-6">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-[var(--fg)]">
            {t('history.title')}
          </h2>
        </header>
        <PaymentHistoryList />
      </section>
    </div>
  );
}
