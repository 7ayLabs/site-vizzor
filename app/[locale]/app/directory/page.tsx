/**
 * /[locale]/app/directory — Skills / Connectors.
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
  // DirectoryShell renders the title block + search row itself so the
  // page wrapper only owns the page-level chrome (max-width + padding).
  return (
    <div className="mx-auto w-full max-w-[1080px] px-6 py-12">
      <DirectoryShell />
    </div>
  );
}
