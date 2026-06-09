/**
 * /[locale]/predict — Vizzor chat surface.
 *
 * Server shell. Locale binding + metadata. The whole interactive shell
 * is a client component (wallet adapter, useChat stream, SWR auth/quota).
 */

import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { PredictShell } from '@/components/predict/predict-shell';

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
  return (
    <main className="relative isolate bg-[var(--bg)]">
      <PredictShell />
    </main>
  );
}
