/**
 * Header — Ollama-style minimalist top bar.
 *
 * Layout: logo + 3-item inline nav (Surfaces, Pricing, Docs) on the left,
 * LanguageSwitch + ThemeToggle + Telegram CTA on the right. The CTA is
 * intentionally reduced to h-8 so the bar reads as "calm chrome", not as
 * the page's loudest object. Border is a thin var(--border) hairline.
 *
 * The "Surfaces" nav item is an anchor to the SurfaceCompare section on
 * the Docs page (`/docs#surfaces`) — the nav surfaces the comparison, not
 * an arbitrary listing route.
 *
 * Server component, async (next-intl getTranslations).
 */
import { getTranslations } from 'next-intl/server';
import type { ComponentProps } from 'react';
import type { Route } from 'next';
import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { ThemeToggle } from './theme-toggle';
import { LanguageSwitch } from './language-switch';

type NavKey = 'surfaces' | 'pricing' | 'docs';
type LinkHref = ComponentProps<typeof Link>['href'];

const NAV: readonly { href: LinkHref; key: NavKey }[] = [
  { href: '/docs#surfaces' as Route, key: 'surfaces' },
  { href: '/pricing', key: 'pricing' },
  { href: '/docs', key: 'docs' },
];

export async function Header() {
  const t = await getTranslations('header');

  return (
    <header
      className="
        sticky top-0 z-40 w-full
        border-b border-[var(--border)]
        bg-[var(--bg)]/85 backdrop-blur-md
        supports-[backdrop-filter]:bg-[var(--bg)]/75
      "
    >
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-7">
          <Link
            href="/"
            aria-label="Vizzor home"
            className="
              inline-flex items-center gap-2
              text-[15px] font-semibold tracking-tight
              text-[var(--fg)] hover:text-[var(--accent)]
              transition-colors
            "
          >
            {/* Two PNGs swapped by theme via the dark: variant wired in
                globals.css (@custom-variant dark → [data-theme="dark"]).
                width/height carry intrinsic 364×535 to lock aspect ratio
                and prevent CLS; the className sizes the rendered output. */}
            <Image
              src="/brand/vizzor_darkicon.png"
              alt=""
              width={364}
              height={535}
              priority
              className="block dark:hidden h-6 w-auto"
            />
            <Image
              src="/brand/vizzor_icon.png"
              alt=""
              width={364}
              height={535}
              priority
              className="hidden dark:block h-6 w-auto"
            />
            <span>vizzor</span>
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--fg-3)]">
              .ai
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-[13px]">
            {NAV.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="
                  text-[var(--fg-2)] hover:text-[var(--fg)]
                  transition-colors
                "
              >
                {t(`nav.${item.key}`)}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <LanguageSwitch />
          <ThemeToggle />
          <a
            href="https://t.me/vizzorai_bot"
            target="_blank"
            rel="noopener"
            className="
              hidden sm:inline-flex h-8 items-center gap-1.5 rounded-full
              bg-[var(--accent)] px-3.5 text-[11.5px] font-semibold
              text-[var(--accent-fg)]
              transition-[transform,box-shadow] duration-150
              hover:scale-[1.02] hover:shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent)_20%,transparent)]
            "
          >
            {t('cta')}
            <span aria-hidden>→</span>
          </a>
        </div>
      </div>
    </header>
  );
}
