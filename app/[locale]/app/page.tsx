import { redirect } from 'next/navigation';

/**
 * /app — default app view. Routes to Chat (the only fully-shipped
 * surface today). Server-side redirect so the URL bar lands on
 * `/app/predict` without a client-side flicker.
 */
export default async function AppIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/app/predict`);
}
