/**
 * /[locale]/pay/success — grant-code handoff.
 *
 * Reads `?id=<sessionId>` from the URL, server-fetches the session,
 * confirms it's in 'confirmed' state with a grant code, then renders
 * the GrantHandoff card. If the session is missing or not confirmed,
 * shows a soft "not ready" state instead of fabricating a code.
 */

import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';
import { GrantHandoff } from '@/components/pay/grant-handoff';
import { getSession } from '@/lib/payment/session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pay');
  return {
    title: t('meta.successTitle'),
    description: t('meta.description'),
  };
}

export default async function PaySuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const { locale } = await params;
  const { id } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('pay');

  let grantCode: string | null = null;
  let pending = false;
  if (id) {
    const result = await getSession(id);
    if (result.ok && result.session.grantCode) {
      grantCode = result.session.grantCode;
    } else {
      pending = true;
    }
  }

  return (
    <section className="relative">
      <div className="mx-auto max-w-[720px] px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
        {grantCode ? (
          <GrantHandoff code={grantCode} />
        ) : (
          <div className="border border-[var(--border)] bg-[var(--surface)] p-6 flex flex-col gap-4">
            <p className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
              {t('success.pendingLabel')}
            </p>
            <h1 className="display text-[var(--fg)] text-[24px] sm:text-[28px] leading-[1.1] tracking-tight font-semibold">
              {t(pending ? 'success.pendingTitle' : 'success.missingTitle')}
            </h1>
            <p className="text-[13.5px] leading-relaxed text-[var(--fg-2)] max-w-[60ch]">
              {t(pending ? 'success.pendingBody' : 'success.missingBody')}
            </p>
            <Link
              href="/pricing"
              className="
                inline-flex items-center justify-center gap-2 h-11 px-4 w-fit
                text-[13px] font-semibold tracking-tight
                border border-[var(--border)] bg-transparent text-[var(--fg)]
                hover:bg-[var(--surface-2)] transition-colors
              "
            >
              <span>{t('success.backToPricing')}</span>
              <span aria-hidden>→</span>
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
