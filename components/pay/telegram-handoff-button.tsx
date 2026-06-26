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
  const label = t('cta.continueInTelegram', { chain: chainLabel });
  // Visual styling stays identical for both the disabled (<button>)
  // and enabled (<a>) branches — only the cursor + opacity shift on
  // disabled, plus the hover lift is dropped. Splitting on the disabled
  // state lets us use a real HTML `disabled` attribute (anchors don't
  // support it) which is what screen readers + form-control semantics
  // expect, rather than the fragile `aria-disabled` + `preventDefault`
  // pair this component shipped with originally.
  const base =
    'group relative inline-flex items-center justify-center gap-2 h-13 px-5 w-full py-3 rounded-xl text-[14px] font-semibold tracking-tight bg-[var(--fg)] text-[var(--bg)] transition-[transform,opacity] duration-200 ease-out';

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        className={`${base} opacity-40 cursor-not-allowed`}
      >
        <span>{label}</span>
        <span aria-hidden>→</span>
      </button>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${base} motion-safe:hover:-translate-y-[1px] hover:opacity-90`}
    >
      <span>{label}</span>
      <span
        aria-hidden
        className="transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-0.5"
      >
        →
      </span>
    </a>
  );
}
