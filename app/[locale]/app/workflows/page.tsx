/**
 * /[locale]/app/workflows — legacy redirect to /app/transactions.
 *
 * v0.5.3 renamed the surface. Keep this page as a 308 permanent
 * redirect for one release so bookmarks, DMs, and any external
 * links (Discord embed cards, mailer templates, engine push copy)
 * stay live. Removing the file entirely would 404 those referrers.
 */

import { redirect } from 'next/navigation';

export const dynamic = 'force-static';

export default async function WorkflowsLegacyRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/app/transactions`);
}
