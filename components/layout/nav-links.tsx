'use client';

/**
 * NavLinks — pill-style top navigation with active-state indicator.
 *
 * Mirrors the reference dashboard navbar: each item is a pill with
 * subtle hover background; the active route gains a tinted bg + a
 * leading accent dash. Active detection uses next-intl's
 * `usePathname` (locale-aware) so `/`, `/es`, `/fr` all resolve to
 * the same nav state.
 *
 * Lives inside the server-rendered <Header> as a client island.
 */

import type { ComponentProps } from 'react';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

type NavKey = 'predict' | 'surfaces' | 'pricing' | 'docs';
type LinkHref = ComponentProps<typeof Link>['href'];

const NAV: readonly { href: LinkHref; key: NavKey; match: RegExp }[] = [
  { href: '/predict', key: 'predict', match: /^\/predict(\/|$)/ },
  { href: '/docs#surfaces' as Route, key: 'surfaces', match: /^\/docs#surfaces/ },
  { href: '/pricing', key: 'pricing', match: /^\/pricing(\/|$)/ },
  { href: '/docs', key: 'docs', match: /^\/docs($|\/)/ },
];

export function NavLinks() {
  const t = useTranslations('header.nav');
  const pathname = usePathname();

  return (
    <nav className="hidden md:flex items-center gap-1 text-[13px]">
      {NAV.map((item) => {
        const isActive = item.match.test(pathname);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={`
              relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5
              transition-colors
              ${
                isActive
                  ? 'bg-[var(--surface-2)] text-[var(--fg)]'
                  : 'text-[var(--fg-2)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]/60'
              }
            `}
          >
            {isActive && (
              <span
                aria-hidden
                className="mono tabular text-[10px] tracking-[0.2em] text-[var(--accent)]"
              >
                ─
              </span>
            )}
            <span>{t(item.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
