/**
 * /[locale]/predict — on-site Vizzor chat surface.
 *
 * Server shell: sets locale, renders metadata, mounts the client
 * <PredictRoute> which owns the chat thread + quota sidebar.
 *
 * Routing context: middleware excludes /api but NOT /predict, so this
 * route lives inside the locale segment like every marketing page. The
 * shell is statically generated per locale; the actual chat is fully
 * dynamic (POST /api/predict) on the client.
 */

import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { PredictRoute } from './predict-route';

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
    <section className="relative">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <PredictRoute />
      </div>
    </section>
  );
}
