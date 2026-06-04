'use client';

/**
 * GrantHandoff — success card with the one-time grant code and a
 * "Continue in Telegram" CTA. The user clicks the CTA to redeem the
 * code in the bot, which binds the subscription to their TG user ID.
 *
 * The grant code itself is shown copy-able too, in case the user
 * prefers to send the deep-link to a different device.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy, Check } from 'lucide-react';

interface GrantHandoffProps {
  code: string;
}

export function GrantHandoff({ code }: GrantHandoffProps) {
  const t = useTranslations('pay.grant');
  const [copied, setCopied] = useState(false);

  const deepLink = `https://t.me/vizzorai_bot?start=grant_${code}`;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(deepLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignored
    }
  };

  return (
    <div className="border border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)] bg-[var(--surface)] p-6 flex flex-col gap-5">
      <p className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
        {t('label')}
      </p>

      <div className="flex flex-col gap-2">
        <h2 className="display text-[22px] sm:text-[26px] font-semibold tracking-tight text-[var(--fg)] leading-tight">
          {t('title')}
        </h2>
        <p className="text-[13.5px] leading-relaxed text-[var(--fg-2)] max-w-[48ch]">
          {t('body')}
        </p>
      </div>

      <a
        href={deepLink}
        target="_blank"
        rel="noopener"
        className="
          inline-flex items-center justify-center gap-2 h-11 px-4
          text-[13px] font-semibold tracking-tight
          bg-[var(--accent)] text-[var(--accent-fg)]
          hover:opacity-90 transition-opacity
        "
      >
        <span>{t('continueCta')}</span>
        <span aria-hidden>→</span>
      </a>

      <div className="border-t border-[var(--border)] pt-4 flex flex-col gap-2">
        <p className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
          {t('codeLabel')}
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 mono tabular text-[12px] bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2 text-[var(--fg)] truncate">
            grant_{code}
          </code>
          <button
            type="button"
            onClick={onCopy}
            aria-label={t('copyAria')}
            title={t('copyAria')}
            className="
              inline-flex items-center justify-center
              h-10 w-10 border border-[var(--border)] bg-[var(--surface)]
              hover:bg-[var(--surface-2)] transition-colors text-[var(--fg-2)]
            "
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <p className="mono tabular text-[9.5px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
          {t('codeTtl')}
        </p>
      </div>
    </div>
  );
}
