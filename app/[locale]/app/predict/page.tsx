/**
 * /[locale]/app/predict — Vizzor chat surface.
 *
 * Server shell. Locale binding + metadata. The wallet adapter and the
 * cross-surface SWR context are mounted by the `/app/*` layout, so this
 * page just renders the client shell directly. The legacy `/predict`
 * URL redirects here via `next.config.ts`.
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
  return <PredictShell />;
}
