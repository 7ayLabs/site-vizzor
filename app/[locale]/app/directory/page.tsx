/**
 * /[locale]/app/directory — Skills / Connectors / Plugins.
 *
 * Server shell sets locale + metadata, then mounts the client island
 * (`DirectoryShell`) which owns tab state, search, and the card grid.
 * SWR-fetches `/api/directory/catalog` so per-wallet install state
 * stays fresh across visibility changes.
 */

import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { DirectoryShell } from './directory-shell';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('app.directory');
  return {
    title: t('meta.title'),
    description: t('meta.description'),
  };
}

export default async function DirectoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('app.directory');

  return (
    <div className="mx-auto w-full max-w-[1080px] px-6 py-12">
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

      <DirectoryShell />
    </div>
  );
}
