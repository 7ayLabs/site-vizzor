/**
 * /[locale]/app/workflows — wallet-scoped workflows list.
 *
 * v0.5.1 — replaces the "Recibos" sidebar entry (which pointed at
 * an anchor inside /app/account). This page consolidates the user's
 * capability intents grouped by the conversation that minted them,
 * so a chat that authored a `send / pay` command shows its history
 * here even if the chat itself is deleted.
 *
 * Server shell: metadata + locale binding. The interactive list is a
 * client component (`WorkflowsList`) that polls `/api/workflows`.
 * Auth is enforced by the API route — signed-out visitors see the
 * empty-state copy with a sign-in hint. Matches the alerts page
 * pattern so the surface reads consistently in the shell.
 */

import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { WorkflowsList } from '@/components/app/workflows-list';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('predict.workflows');
  return {
    title: t('meta.title'),
    description: t('meta.description'),
  };
}

export default async function WorkflowsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('predict.workflows');

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

      <WorkflowsList />
    </div>
  );
}
