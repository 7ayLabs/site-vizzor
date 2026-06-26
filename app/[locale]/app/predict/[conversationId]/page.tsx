/**
 * /[locale]/app/predict/[conversationId] — shareable conversation deep link.
 *
 * Server component. Loads the conversation + messages with an
 * ownership check (wallet_address = active SIWS session wallet) and
 * hydrates the client shell so the user lands directly on the thread
 * without a client-side fetch flash.
 *
 * Security posture:
 *   - Unauthenticated → redirect to /app/predict?from=share (the
 *     selector modal there surfaces sign-in).
 *   - Authenticated but not the owner → `notFound()` (404). MUST NOT
 *     return 403 or any other code that would leak the conversation's
 *     existence to non-owners.
 *   - Authenticated AND the owner → render PredictShell with the
 *     initial conversation hydrated.
 *
 * The route is SIWS-gated end-to-end; no client-side ownership check is
 * needed (and any client check would be a defense-in-depth nicety, not
 * an authz boundary).
 */

import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import {
  PredictShell,
  type InitialConversation,
} from '@/components/predict/predict-shell';
import { getActiveSession } from '@/lib/payment/auth-session';
import {
  getConversationForWallet,
  listMessagesForConversation,
} from '@/lib/payment/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PageProps {
  params: Promise<{ locale: string; conversationId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('predict');
  return {
    title: t('meta.title'),
    description: t('meta.description'),
  };
}

export default async function SharedConversationPage({ params }: PageProps) {
  const { locale, conversationId } = await params;
  setRequestLocale(locale);

  const session = await getActiveSession();
  if (!session) {
    redirect(`/${locale}/app/predict?from=share`);
  }

  const conv = getConversationForWallet(conversationId, session.wallet);
  if (!conv) {
    // 404 (not 403) — non-owners must not learn the conversation exists.
    notFound();
  }

  const messages = listMessagesForConversation(conv.id);
  const initialConversation: InitialConversation = {
    id: conv.id,
    title: conv.title,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
    })),
  };

  return <PredictShell initialConversation={initialConversation} />;
}
