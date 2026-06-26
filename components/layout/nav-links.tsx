'use client';

/**
 * NavLinks — pill-style top navigation with active-state indicator.
 *
 * Context-aware colors: reads from four optional CSS custom
 * properties on its parent so the same primitive renders correctly
 * inside the dark-pill header (light text on dark bg) AND inside any
 * future light context (dark text on light bg) without forking. When
 * the parent doesn't set them, the original `--fg-2` / `--fg` /
 * `--surface-2` defaults apply.
 *
 *   --nav-link             default link color
 *   --nav-link-hover       hover/foreground link color
 *   --nav-link-active-bg   active-route pill background
 *   --nav-link-active-fg   active-route pill foreground
 *
 * Active detection uses next-intl's `usePathname` (locale-aware) so
 * `/`, `/es`, `/fr` all resolve to the same nav state.
 */

import type { ComponentProps } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

type NavKey = 'manifesto' | 'pricing' | 'changelog' | 'docs';
type LinkHref = ComponentProps<typeof Link>['href'];

// Marketing nav — Manifesto · Pricing · Changelog · Docs. The CTA into
// the product (Open App ↗) is rendered separately by the Header so it
// can carry a visual distinction (right-arrow, different weight) from
// the marketing items. Predict no longer earns a nav slot — it's a
// product surface, reachable from the explicit "Open App" CTA.
const NAV: readonly { href: LinkHref; key: NavKey; match: RegExp }[] = [
  { href: '/manifesto', key: 'manifesto', match: /^\/manifesto(\/|$)/ },
  { href: '/pricing', key: 'pricing', match: /^\/pricing(\/|$)/ },
  { href: '/changelog', key: 'changelog', match: /^\/changelog(\/|$)/ },
  { href: '/docs', key: 'docs', match: /^\/docs($|\/)/ },
];

export function NavLinks() {
  const t = useTranslations('header.nav');
  const pathname = usePathname();

  return (
    <nav className="hidden md:flex items-center gap-0.5 text-[13px]">
      {NAV.map((item) => {
        const isActive = item.match.test(pathname);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className="
              inline-flex items-center rounded-full px-3.5 py-1.5
              transition-colors duration-150 ease-out
              text-[var(--nav-link,var(--fg-2))]
              hover:text-[var(--nav-link-hover,var(--fg))]
              hover:bg-[var(--nav-link-active-bg,var(--surface-2))]
              aria-[current=page]:text-[var(--nav-link-active-fg,var(--fg))]
              aria-[current=page]:bg-[var(--nav-link-active-bg,var(--surface-2))]
            "
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
