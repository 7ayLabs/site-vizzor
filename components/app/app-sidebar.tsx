'use client';

/**
 * AppSidebar — persistent left rail for the /app/* shell.
 *
 * Three sections:
 *   1. Top — Vizzor mark + wallet pill (mirrors the navbar SignedInBadge,
 *      so connected wallet + tier badge stay visible across surfaces).
 *   2. Middle — surface switcher. Chat → /app/predict, plus the
 *      Elite-tier surfaces (Whales, Flow) that already exist. Locked
 *      surfaces stay visible with a subtle disabled tooltip so users
 *      see the product breadth before they upgrade.
 *   3. Bottom — settings, pricing, docs, sign-out shortcuts.
 *
 * The Cmd+K palette (Phase E) exposes the same destinations as a
 * keyboard-first overlay; this sidebar is the mouse-first equivalent.
 */

import { useTranslations } from 'next-intl';
import {
  MessageSquare,
  Waves,
  Activity,
  Bell,
  Settings,
  Receipt,
  BookOpen,
  Tag,
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import Image from 'next/image';
import { WalletAuthButton } from '@/components/auth/wallet-auth-button';
import { StatusPill } from './status-pill';

type SurfaceKey = 'predict' | 'whales' | 'flow';

interface SurfaceItem {
  key: SurfaceKey;
  href: '/app/predict' | '/app/whales' | '/app/flow';
  match: RegExp;
  icon: typeof MessageSquare;
  tier?: 'elite';
}

const SURFACES: ReadonlyArray<SurfaceItem> = [
  { key: 'predict', href: '/app/predict', match: /^\/app\/predict(\/|$)/, icon: MessageSquare },
  { key: 'whales', href: '/app/whales', match: /^\/app\/whales(\/|$)/, icon: Waves, tier: 'elite' },
  { key: 'flow', href: '/app/flow', match: /^\/app\/flow(\/|$)/, icon: Activity, tier: 'elite' },
];

interface FooterItem {
  key: 'alerts' | 'settings' | 'billing' | 'pricing' | 'docs';
  href: '/app/alerts' | '/app/settings' | '/app/billing' | '/pricing' | '/docs';
  match: RegExp;
  icon: typeof Settings;
  external?: boolean;
}

// Alerts is intentionally a footer item (utility / status surface),
// not a primary surface. The product hierarchy: surfaces = "what you
// do here" (predict, whales, flow); footer = "your account state"
// (alerts, settings, billing) + outbound utility (pricing, docs).
const FOOTER_ITEMS: ReadonlyArray<FooterItem> = [
  { key: 'alerts', href: '/app/alerts', match: /^\/app\/alerts(\/|$)/, icon: Bell },
  { key: 'settings', href: '/app/settings', match: /^\/app\/settings(\/|$)/, icon: Settings },
  { key: 'billing', href: '/app/billing', match: /^\/app\/billing(\/|$)/, icon: Receipt },
  { key: 'pricing', href: '/pricing', match: /^\/pricing(\/|$)/, icon: Tag },
  // Docs lives outside /app/* (EN-only per locale rule), so an `<a>` to
  // /docs leaves the app shell entirely. We mark it visually with an
  // arrow so users expect the chrome change.
  { key: 'docs', href: '/docs', match: /^\/docs(\/|$)/, icon: BookOpen, external: true },
];

// Surfaces that own their own internal navigation chrome and should
// render full-width without the app sidebar. /app/predict has a
// 3-column shell (left conversation list + center thread + right
// widgets) that pre-dates the umbrella migration — overlaying the app
// sidebar on top of it would create 4 columns of chrome and squeeze the
// chat thread. Surface-switching from inside Chat still works via
// Cmd+K → "Go to Whales" / etc.
const SIDEBAR_SUPPRESSED_RE = /^\/app\/predict(\/|$)/;

export function AppSidebar() {
  const t = useTranslations('app.sidebar');
  const pathname = usePathname();

  if (SIDEBAR_SUPPRESSED_RE.test(pathname)) return null;

  return (
    <aside
      className="
        hidden lg:flex flex-col
        w-[260px] shrink-0
        border-r border-[var(--border)] bg-[var(--surface)]
        h-dvh sticky top-0
      "
    >
      {/* ── Top: brand + wallet ──────────────────────────────────── */}
      <div className="px-4 py-4 border-b border-[var(--border)] flex flex-col gap-3">
        <Link
          href="/app/predict"
          className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-[var(--fg)] hover:text-[var(--accent)] transition-colors"
        >
          <Image
            src="/brand/vizzor_darkicon.png"
            alt=""
            width={364}
            height={535}
            priority
            className="block dark:hidden h-5 w-auto"
          />
          <Image
            src="/brand/vizzor_icon.png"
            alt=""
            width={364}
            height={535}
            priority
            className="hidden dark:block h-5 w-auto"
          />
          <span>vizzor</span>
        </Link>
        <WalletAuthButton hasProvider={true} useModal={true} />
      </div>

      {/* ── Middle: surface switcher ─────────────────────────────── */}
      <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5 overflow-y-auto">
        <p className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--fg-3)] px-2 py-1.5">
          {t('section.surfaces')}
        </p>
        {SURFACES.map((item) => {
          const Icon = item.icon;
          const active = item.match.test(pathname);
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`
                group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2
                text-[13px] transition-colors
                ${
                  active
                    ? 'bg-[var(--surface-2)] text-[var(--fg)] font-medium'
                    : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]'
                }
              `}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute left-[-2px] top-[25%] bottom-[25%] w-[2px] rounded-sm bg-[var(--fg)]"
                />
              )}
              <Icon size={14} strokeWidth={1.75} className="shrink-0" />
              <span className="flex-1">{t(`surface.${item.key}`)}</span>
              {item.tier === 'elite' && (
                <span className="mono tabular text-[9px] uppercase tracking-[0.14em] text-[var(--accent)]">
                  {t('tier.elite')}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── Bottom: utility links ────────────────────────────────── */}
      <div className="px-2 py-3 border-t border-[var(--border)] flex flex-col gap-0.5">
        {FOOTER_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.match.test(pathname);
          if (item.external) {
            return (
              <a
                key={item.key}
                href={item.href}
                className="
                  flex items-center gap-2.5 rounded-lg px-2.5 py-2
                  text-[12.5px] text-[var(--fg-3)] hover:text-[var(--fg)]
                  hover:bg-[var(--surface-2)] transition-colors
                "
              >
                <Icon size={13} strokeWidth={1.75} className="shrink-0" />
                <span className="flex-1">{t(`footer.${item.key}`)}</span>
                <span aria-hidden className="text-[10px]">↗</span>
              </a>
            );
          }
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`
                flex items-center gap-2.5 rounded-lg px-2.5 py-2
                text-[12.5px] transition-colors
                ${
                  active
                    ? 'bg-[var(--surface-2)] text-[var(--fg)]'
                    : 'text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]'
                }
              `}
            >
              <Icon size={13} strokeWidth={1.75} className="shrink-0" />
              <span>{t(`footer.${item.key}`)}</span>
            </Link>
          );
        })}
        {/* Status pill — last item so it anchors the rail bottom and
            stays visible even when the surface list scrolls. */}
        <div className="pt-2 mt-2 border-t border-[var(--border)]">
          <StatusPill />
        </div>
      </div>
    </aside>
  );
}
