/**
 * Header — floating-pill navbar (capsule style).
 *
 * Single rounded-full pill that floats with margin from the viewport
 * edges. The pill itself MATCHES the page mode — light in light mode,
 * dark in dark mode — so it reads as an elevated card from the page
 * surface rather than an inverted brand artifact. Visual presence comes
 * from a hairline border + drop shadow, not from a contrasting fill.
 *
 * The INNER elements provide contrast:
 *   - Open-App primary CTA pill is inverted (bg-[--fg], text-[--bg])
 *     so it punches against the pill chrome.
 *   - Telegram brand-blue circle is fixed (#229ED9) — brand identifier,
 *     doesn't bend to the palette.
 *   - Logo badge uses --bg, one shade off the pill, so the badge reads
 *     as a small inset within the pill chrome.
 *   - Nav links use the NavLinks defaults (--fg-2 / --surface-2) since
 *     the pill bg is --surface; the defaults give correct contrast in
 *     both themes without per-context overrides.
 *
 * Wallet connect lives ONLY inside `/app/*` (see app-sidebar.tsx).
 * Theme + language pickers live in the marketing footer.
 *
 * Server component, async (next-intl getTranslations).
 */
import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import { ArrowUpRight, Terminal } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { MobileMenu } from './mobile-menu';
import { NavLinks } from './nav-links';
import { TelegramIcon } from '@/components/icons/telegram-icon';
import { getAppLinkTarget } from '@/lib/app-url';

export async function Header() {
  const t = await getTranslations('header');
  const appLink = getAppLinkTarget();
  const openAppClasses = `
    group inline-flex items-center gap-1.5
    h-9 sm:h-11 px-3.5 sm:px-5
    rounded-full
    bg-[var(--fg)] text-[var(--bg)]
    text-[12.5px] sm:text-[13.5px] font-semibold tracking-tight
    transition-transform duration-200 ease-out
    hover:scale-[1.03] active:scale-[0.98]
    focus-visible:outline-none focus-visible:ring-2
    focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2
    focus-visible:ring-offset-[var(--surface)]
  `;
  const openAppContent = (
    <>
      <span>{t('openApp')}</span>
      <ArrowUpRight
        size={13}
        strokeWidth={2.25}
        className="transition-transform duration-200 ease-out group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
      />
    </>
  );

  return (
    <header className="sticky top-0 z-40 w-full px-3 sm:px-6 pt-3 sm:pt-4 pb-3 pointer-events-none">
      <div
        className="
          pointer-events-auto
          mx-auto max-w-[1100px]
          flex items-center justify-between gap-3
          h-12 sm:h-14
          pl-1.5 pr-1.5
          rounded-full
          bg-[var(--surface)] text-[var(--fg)]
          border border-[var(--border)]
          shadow-[0_10px_40px_-16px_rgba(0,0,0,0.18)]
          dark:shadow-[0_10px_40px_-10px_rgba(0,0,0,0.65)]
        "
      >
        {/* ── LEFT: logo badge + inline nav ─────────────────────────── */}
        <div className="flex items-center gap-1 sm:gap-5 min-w-0">
          <Link
            href="/"
            aria-label="Vizzor home"
            className="
              group inline-flex items-center justify-center shrink-0
              h-9 w-9 sm:h-11 sm:w-11
              rounded-full bg-[var(--bg)] border border-[var(--border)]
              transition-transform duration-200 ease-out
              hover:scale-[1.06] active:scale-[0.98]
              focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2
              focus-visible:ring-offset-[var(--surface)]
            "
          >
            {/* Badge bg = --bg (cream in light, near-black in dark) →
                mark inside is the dark icon in light mode and the
                light icon in dark mode. */}
            <Image
              src="/brand/vizzor_darkicon.png"
              alt=""
              width={364}
              height={535}
              priority
              className="block dark:hidden h-5 sm:h-6 w-auto"
            />
            <Image
              src="/brand/vizzor_icon.png"
              alt=""
              width={364}
              height={535}
              priority
              className="hidden dark:block h-5 sm:h-6 w-auto"
            />
          </Link>

          {/* Inline nav — desktop only. NavLinks' default tokens
              (--fg-2 / --fg / --surface-2) work cleanly against the
              --surface pill bg, so no per-context overrides needed. */}
          <div className="hidden md:block">
            <NavLinks />
          </div>
        </div>

        {/* ── RIGHT: CLI + Telegram + Open-App + mobile trigger ─────── */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* CLI icon button — desktop only. Monochrome (matches the
              surface palette, no brand color). Links to the CLI docs. */}
          <Link
            href="/docs/cli"
            aria-label="Vizzor CLI"
            title="Vizzor CLI"
            className="
              group hidden sm:inline-flex items-center justify-center shrink-0
              h-9 w-9 sm:h-11 sm:w-11
              rounded-full
              text-[var(--fg-2)] bg-[var(--surface-2)]
              border border-[var(--border)]
              transition-[transform,background-color,border-color,color] duration-200 ease-out
              hover:scale-[1.06] active:scale-[0.98]
              hover:text-[var(--fg)] hover:border-[var(--border-hi)]
              focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-[var(--accent)]
              focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]
            "
          >
            <Terminal
              aria-hidden
              size={15}
              strokeWidth={1.75}
              className="transition-transform duration-200 ease-out group-hover:scale-110"
            />
          </Link>

          {/* Telegram brand-blue circle button — desktop only. Fixed
              brand color across themes. */}
          <a
            href="https://t.me/vizzorai_bot"
            target="_blank"
            rel="noopener"
            aria-label={t('cta')}
            title={t('cta')}
            className="
              group hidden sm:inline-flex items-center justify-center shrink-0
              h-9 w-9 sm:h-11 sm:w-11
              rounded-full text-white
              bg-[#229ED9] hover:bg-[#1B8FC4]
              transition-[transform,background-color] duration-200 ease-out
              hover:scale-[1.06] active:scale-[0.98]
              focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-[#229ED9]
              focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]
            "
          >
            <TelegramIcon
              size={15}
              className="transition-transform duration-200 ease-out group-hover:scale-110"
            />
          </a>

          {/* Open-App primary CTA — INVERTED bg/fg so it reads as the
              loudest element inside the surface-toned pill. URL +
              target resolved by `getAppLinkTarget()`: in prod the
              link goes to `app.vizzor.ai` in a new tab; in dev it
              stays on the in-site `/app/predict` route via the
              locale-aware Link. */}
          {appLink.external ? (
            <a
              href={appLink.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${t('openApp')} (opens in a new tab)`}
              className={openAppClasses}
            >
              {openAppContent}
            </a>
          ) : (
            <Link href={appLink.href as '/app/predict'} className={openAppClasses}>
              {openAppContent}
            </Link>
          )}
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
