/**
 * /[locale]/predict — Vizzor chat surface.
 *
 * Server shell — locale binding + metadata. The whole interactive
 * surface (sidebar, thread, composer) lives in <PredictShell>, a
 * client component. The shell takes the full remaining viewport
 * below the site header so it reads as a chat app.
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
