/**
 * /[locale]/app — default app view. v0.5.23 replaces the previous
 * server-side redirect to `/app/predict` with a direct `<PredictShell />`
 * render so the URL stays at `/app` without the user ever seeing the
 * umbrella `AppSidebar` chrome flash on the way through. The predict
 * shell owns its own `LeftRail`, so the layout's `AppShellRail`
 * suppresses itself for both paths (see `PREDICT_RE` there).
 *
 * Kept in a separate page rather than sharing metadata + a component
 * with `/app/predict/page.tsx` — Next.js treats these as distinct
 * routes with distinct metadata caches, so co-locating each page's
 * metadata beside its route file keeps the RSC boundary clear.
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

export default async function AppIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PredictShell />;
}
