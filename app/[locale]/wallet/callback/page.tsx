/**
 * /wallet/callback — mobile-wallet Connect Protocol return target.
 *
 * Phantom / Solflare redirect here after the user approves a connect
 * or signMessage prompt. The real work lives in the client component;
 * this server page only sets the request locale so `useTranslations`
 * works inside it and reserves the route under the locale segment.
 *
 * The page never renders for desktop flows — the wallet-adapter path
 * handles the connect handshake in-process and never navigates here.
 */

import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { WalletCallback } from '@/components/wallet/wallet-callback';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'auth.callback' });
  return {
    title: t('meta.title'),
    robots: { index: false, follow: false },
  };
}

export default async function WalletCallbackPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <WalletCallback />;
}
