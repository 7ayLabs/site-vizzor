/**
 * /[locale]/app/transactions — wallet-scoped capability transactions.
 *
 * v0.5.3 — renamed from /app/workflows. This is the user's audit +
 * action surface for every intent their wallet drafted through the
 * composer's `send / pay` capabilities: pending signatures, signed
 * scheduled payments awaiting broadcast, executed on-chain results,
 * and terminal failures/expirations. Rebuilt around a compact row
 * list with filters and a details sheet instead of the previous
 * conversation-grouped card layout.
 *
 * Server shell: metadata + locale binding. The interactive list is a
 * client component (`TransactionsList`) that polls `/api/workflows`
 * (route stays workflows-named until a follow-up rename) and clears
 * the workflow-bucket notifications on mount — visiting this page IS
 * the "seen" signal.
 */

import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { TransactionsList } from '@/components/app/transactions-list';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('predict.transactions');
  return {
    title: t('meta.title'),
    description: t('meta.description'),
  };
}

export default async function TransactionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('predict.transactions');

  return (
    <div className="mx-auto w-full max-w-[920px] px-6 py-12">
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

      <TransactionsList />
    </div>
  );
}
