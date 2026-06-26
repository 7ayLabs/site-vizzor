import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';

/**
 * /app/settings — minimal placeholder surface.
 *
 * Phase A scope: the sidebar links here, so the link must resolve. Real
 * settings (notification prefs, default tier, danger zone for account
 * deletion) land in a follow-up phase. For now the page surfaces the
 * existing `/account` view as the canonical place to manage the wallet
 * + subscription.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('app.settings');
  return {
    title: t('meta.title'),
    description: t('meta.description'),
  };
}

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('app.settings');

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-12">
      <h1 className="display text-[28px] sm:text-[32px] leading-tight tracking-tight font-semibold text-[var(--fg)]">
        {t('title')}
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-[var(--fg-2)]">
        {t('body')}
      </p>
      <div className="mt-8 border border-[var(--border)] bg-[var(--surface)] rounded-2xl p-6 flex flex-col gap-3">
        <p className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--accent)]">
          {t('accountLink.label')}
        </p>
        <a
          href={`/${locale === 'en' ? '' : `${locale}/`}account`}
          className="text-[14px] underline underline-offset-4 text-[var(--fg)] hover:text-[var(--accent)]"
        >
          {t('accountLink.cta')}
        </a>
      </div>
    </div>
  );
}
