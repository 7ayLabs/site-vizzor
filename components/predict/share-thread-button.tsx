'use client';

/**
 * ShareThreadButton — copies a deep-link URL for the active conversation.
 *
 * Build target: `${origin}/${locale prefix}/app/predict/${conversationId}`.
 * The `(marketing)` route group is invisible to URLs (parenthesized
 * segment) and `/app/*` paths don't carry an `en` prefix per next-intl
 * `as-needed`, so the URL renders cleanly for sharing.
 *
 * Security: the URL is sharable but the route is SIWS-gated AND
 * ownership-checked server-side (`getConversationForWallet`). A leaked
 * URL renders 404 to any wallet that doesn't own the conversation.
 */

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Share2, Check } from 'lucide-react';
import { toast } from 'sonner';

interface ShareThreadButtonProps {
  conversationId: string | null;
  /** Optional label override for the visible text. Default: i18n key. */
  label?: string;
}

export function ShareThreadButton({ conversationId, label }: ShareThreadButtonProps) {
  const t = useTranslations('predict.share');
  const locale = useLocale();
  const [copied, setCopied] = useState(false);

  if (!conversationId) return null;

  const handleShare = async () => {
    if (typeof window === 'undefined') return;
    const origin = window.location.origin;
    // next-intl `as-needed`: en at root, /es and /fr prefixed.
    const prefix = locale === 'en' ? '' : `/${locale}`;
    const url = `${origin}${prefix}/app/predict/${conversationId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t('copied'), { description: url });
      window.setTimeout(() => setCopied(false), 1_500);
    } catch (e) {
      toast.error(t('copyFailed'), { description: (e as Error).message });
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleShare()}
      aria-label={t('aria')}
      className="
        inline-flex h-7 items-center gap-1.5 rounded-md
        border border-[var(--border)] bg-transparent px-2
        text-[11px] text-[var(--fg-2)]
        hover:bg-[var(--surface-2)] hover:text-[var(--fg)]
        transition-colors
      "
    >
      {copied ? <Check size={11} strokeWidth={2} /> : <Share2 size={11} strokeWidth={2} />}
      <span>{label ?? t('label')}</span>
    </button>
  );
}
