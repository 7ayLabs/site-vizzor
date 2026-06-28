/**
 * /account — legacy redirect surface.
 *
 * The profile + subscription overview now lives at /app/account so the
 * app and the marketing site can stay 100% separate. This file is the
 * back-compat shim: any external bookmark or stale link landing here
 * gets a 308 redirect to the new app-shell route.
 *
 * The server redirect runs before any layout mounts, so the marketing
 * chrome (header / footer / ticker) never paints — the user just sees
 * the URL update to /app/account and the app shell renders.
 */

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AccountRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/app/account`);
}
