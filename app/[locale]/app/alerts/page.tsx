/**
 * /[locale]/app/alerts — wallet-scoped alerts list.
 *
 * Server shell. The interactive list (`AlertsList`) is a client
 * component that polls `/api/alerts` every 30s. The page itself is
 * just locale binding + metadata + the mount point.
 *
 * Authentication is enforced by the API route, not here — signed-out
 * visitors see the empty-state copy with a sign-in hint. This keeps
 * the surface SEO-neutral (no redirect chain on first paint).
 */

import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { AlertsList } from '@/components/app/alerts-list';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('app.alerts');
  return {
    title: t('meta.title'),
    description: t('meta.description'),
  };
}

export default async function AlertsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('app.alerts');

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

      <AlertsList />
    </div>
  );
}
