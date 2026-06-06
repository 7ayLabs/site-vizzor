'use client';

/**
 * TelegramHandoffButton — terminal CTA for chains whose on-site
 * watcher hasn't shipped yet (TON, USDC Base, USDC Arbitrum).
 *
 * Once the user picks a non-SOL rail, the session is created locally
 * (so the rate lock + grant code path stays consistent), then the
 * user is deep-linked into the Telegram bot. The bot owns the
 * TON Connect / EVM wallet flow there and writes back into the same
 * subscriptions / wallet_links tables.
 */

import { useTranslations } from 'next-intl';

interface TelegramHandoffButtonProps {
  sessionId: string;
  chainLabel: string;
  disabled?: boolean;
}

const TG_USERNAME = process.env.NEXT_PUBLIC_TG_BOT_USERNAME ?? 'vizzorai_bot';

export function TelegramHandoffButton({
  sessionId,
  chainLabel,
  disabled,
}: TelegramHandoffButtonProps) {
  const t = useTranslations('pay');
  const href = `https://t.me/${TG_USERNAME}?start=pay_${sessionId}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-disabled={disabled}
      onClick={(e) => {
        if (disabled) e.preventDefault();
      }}
      className={`
        group relative inline-flex items-center justify-center gap-2 h-12 px-5 w-full
        rounded-xl text-[13px] font-semibold tracking-tight
        bg-[var(--accent)] text-[var(--accent-fg)]
        transition-[transform,opacity,box-shadow] duration-200 ease-out
        shadow-[0_8px_28px_-12px_color-mix(in_oklab,var(--accent)_60%,transparent)]
        motion-safe:hover:-translate-y-[1px]
        motion-safe:hover:shadow-[0_12px_30px_-12px_color-mix(in_oklab,var(--accent)_70%,transparent)]
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-95'}
      `}
    >
      <span>{t('cta.continueInTelegram', { chain: chainLabel })}</span>
      <span
        aria-hidden
        className="transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-0.5"
      >
        →
      </span>
    </a>
  );
}
