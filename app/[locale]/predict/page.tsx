/**
 * /[locale]/predict — Vizzor dashboard surface.
 *
 * Server shell: locale binding, metadata, then composes the dashboard
 * — top stat row, chat + tier donut, recent predictions table.
 *
 * The chat itself stays client-rendered (interactive), but all the
 * read-only panels (stat cards, donut, table) are server components
 * that read the committed snapshot directly. This keeps the initial
 * HTML rich and the JS payload small.
 */

import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { PredictRoute } from './predict-route';
import { StatCards } from '@/components/dashboard/stat-cards';
import { TierDonut } from '@/components/dashboard/tier-donut';
import { PredictionsTable } from '@/components/dashboard/predictions-table';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('predict');
  return {
    title: t('meta.title'),
    description: t('meta.description'),
  };
}

export default async function PredictPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('predict');

  return (
    <section className="relative">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-8 lg:py-10 flex flex-col gap-6">
        {/* Page header */}
        <header className="flex flex-col gap-2">
          <p className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
            {t('eyebrow')}
          </p>
          <h1 className="display text-[var(--fg)] text-balance text-[28px] sm:text-[34px] lg:text-[40px] leading-[1.05] tracking-tight font-semibold">
            {t('title')}
          </h1>
          <p className="text-[14px] leading-relaxed text-[var(--fg-2)] max-w-[60ch]">
            {t('sub')}
          </p>
        </header>

        {/* Row 1 — stat cards */}
        <StatCards />

        {/* Row 2 — chat (lg:60%) + donut (lg:40%) */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          <PredictRoute />
          <TierDonut />
        </div>

        {/* Row 3 — recent predictions table */}
        <PredictionsTable />
      </div>
    </section>
  );
}
