/**
 * Footer — five-column structural footer with a subtle accent hairline.
 *
 * Columns: brand · surfaces · project (with the blog listed here alongside
 * the manifesto / pricing / privacy / license links) · community
 * (Telegram/Discord/GitHub/X/Mastodon as external links with icons) ·
 * resources. Stacks to a 2-col grid on mobile.
 *
 * The license badge and copyright sit on a thin bottom row; the previous
 * separate social row is gone (its links live in the Community column now).
 *
 * Top of footer carries a 1px gradient accent hairline so the section break
 * from the page above reads at a glance without a heavy border.
 *
 * Server component — pure render, no client state.
 */
import type { ComponentProps } from 'react';
import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import {
  Activity,
  AtSign,
  BookOpen,
  Code2,
  FileText,
  Github,
  History,
  Lock,
  MessagesSquare,
  Receipt,
  Scale,
  Send,
  Terminal,
  Twitter,
  Zap,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { LanguageSwitch } from './language-switch';
import { ThemeToggle } from './theme-toggle';

type LinkHref = ComponentProps<typeof Link>['href'];

type InternalItem = { href: LinkHref; key: string; external?: false };
type ExternalItem = { href: string; key: string; external: true };
type FooterItem = InternalItem | ExternalItem;

const SURFACES: readonly FooterItem[] = [
  { href: '/docs/telegram', key: 'telegram' },
  { href: '/docs/cli', key: 'cli' },
  { href: '/docs/api', key: 'api' },
  { href: '/docs/discord', key: 'discord' },
];

const PROJECT: readonly FooterItem[] = [
  { href: '/manifesto', key: 'manifesto' },
  { href: '/pricing', key: 'pricing' },
  { href: '/blog', key: 'blog' },
  { href: '/legal/privacy', key: 'privacy' },
  {
    href: 'https://github.com/7ayLabs/vizzor/blob/main/LICENSE.md',
    key: 'license',
    external: true,
  },
];

const COMMUNITY: readonly FooterItem[] = [
  { href: 'https://t.me/vizzorlabs', key: 'telegramChannel', external: true },
  { href: 'https://discord.gg/vizzor', key: 'discord', external: true },
  {
    href: 'https://github.com/7ayLabs/vizzor/discussions',
    key: 'github',
    external: true,
  },
  { href: 'https://x.com/vizzorlabs', key: 'x', external: true },
  { href: 'https://hachyderm.io/@vizzorlabs', key: 'mastodon', external: true },
];

const RESOURCES: readonly FooterItem[] = [
  { href: '/docs/quickstart', key: 'quickstart' },
  { href: '/docs/chronovisor', key: 'chronovisor' },
  { href: '/docs', key: 'docsIndex' },
];

// Lucide doesn't export a dedicated Mastodon glyph; AtSign is the canonical
// fallback used across the design system for fediverse identifiers.
type LucideIcon = React.ComponentType<{ size?: number; strokeWidth?: number }>;

const SURFACE_ICONS: Record<string, LucideIcon> = {
  telegram: Send,
  cli: Terminal,
  api: Code2,
  discord: MessagesSquare,
};

const PROJECT_ICONS: Record<string, LucideIcon> = {
  manifesto: FileText,
  pricing: Receipt,
  blog: History,
  privacy: Lock,
  license: Scale,
};

const COMMUNITY_ICONS: Record<string, LucideIcon> = {
  telegramChannel: Send,
  discord: MessagesSquare,
  github: Github,
  x: Twitter,
  mastodon: AtSign,
};

const RESOURCE_ICONS: Record<string, LucideIcon> = {
  quickstart: Zap,
  chronovisor: Activity,
  docsIndex: BookOpen,
};

export async function Footer() {
  const t = await getTranslations('footer');

  return (
    <footer className="relative border-t border-[var(--border)] bg-[var(--surface-2)] mt-24">

      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-14 md:py-20">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-5">
          <div className="col-span-2 md:col-span-1">
            <Link
              href="/"
              aria-label="Vizzor home"
              className="inline-flex items-center gap-2 text-[15px] font-semibold tracking-tight text-[var(--fg)]"
            >
              <Image
                src="/brand/vizzor_darkicon.png"
                alt=""
                width={364}
                height={535}
                className="block dark:hidden h-6 w-auto"
              />
              <Image
                src="/brand/vizzor_icon.png"
                alt=""
                width={364}
                height={535}
                className="hidden dark:block h-6 w-auto"
              />
              <span>vizzor</span>
            </Link>
            <p className="mt-3 text-[13px] leading-relaxed text-[var(--fg-2)] max-w-[260px]">
              {t('tagline')}
            </p>
          </div>

          <FooterCol
            title={t('columns.surfaces.title')}
            items={SURFACES}
            labels={{
              telegram: t('columns.surfaces.telegram'),
              cli: t('columns.surfaces.cli'),
              api: t('columns.surfaces.api'),
              discord: t('columns.surfaces.discord'),
            }}
            icons={SURFACE_ICONS}
          />
          <FooterCol
            title={t('columns.project.title')}
            items={PROJECT}
            labels={{
              manifesto: t('columns.project.manifesto'),
              pricing: t('columns.project.pricing'),
              blog: t('columns.project.blog'),
              privacy: t('columns.project.privacy'),
              license: t('columns.project.license'),
            }}
            icons={PROJECT_ICONS}
          />
          <FooterCol
            title={t('columns.community.title')}
            items={COMMUNITY}
            labels={{
              telegramChannel: t('columns.community.telegramChannel'),
              discord: t('columns.community.discord'),
              github: t('columns.community.github'),
              x: t('columns.community.x'),
              mastodon: t('columns.community.mastodon'),
            }}
            icons={COMMUNITY_ICONS}
          />
          <FooterCol
            title={t('columns.resources.title')}
            items={RESOURCES}
            labels={{
              quickstart: t('columns.resources.quickstart'),
              chronovisor: t('columns.resources.chronovisor'),
              docsIndex: t('columns.resources.docsIndex'),
            }}
            icons={RESOURCE_ICONS}
          />
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-[var(--border)] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 text-[12px] text-[var(--fg-3)]">
            <span className="rounded border border-[var(--border)] px-2 py-0.5 mono tabular text-[10px]">
              {t('license')}
            </span>
            <span>
              {t('copyright', { year: new Date().getFullYear() })}{' '}
              <a
                href="https://7aylabs.com"
                target="_blank"
                rel="noopener"
                className="text-[var(--fg-2)] underline-offset-4 hover:text-[var(--fg)] hover:underline"
              >
                {t('builder')}
              </a>
            </span>
          </div>
          {/* Set-once preference cluster — language + theme. Both
              follow the Stripe / Cloudflare pattern of living at the
              page foot rather than the navbar. `placement=up` flips
              the language dropdown so it doesn't drop off the page
              bottom. ThemeToggle stays inline (it owns its own popover
              positioning when needed). */}
          <div className="flex items-center gap-3">
            <LanguageSwitch placement="up" />
            <ThemeToggle />
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  items,
  labels,
  icons,
}: {
  title: string;
  items: readonly FooterItem[];
  labels: Record<string, string>;
  icons?: Record<string, LucideIcon>;
}) {
  return (
    <div>
      <h4 className="eyebrow text-[var(--fg-3)] text-[10px] mb-3">{title}</h4>
      <ul className="space-y-2">
        {items.map((item) => {
          const label = labels[item.key] ?? item.key;
          const Icon = icons?.[item.key];
          const inner = (
            <span className="inline-flex items-center gap-2">
              {Icon ? (
                <Icon size={13} strokeWidth={1.75} />
              ) : null}
              <span>{label}</span>
            </span>
          );
          return (
            <li key={item.key}>
              {item.external ? (
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener"
                  className="text-[13px] text-[var(--fg-2)] hover:text-[var(--fg)] transition-colors"
                >
                  {inner}
                </a>
              ) : (
                <Link
                  href={item.href}
                  className="text-[13px] text-[var(--fg-2)] hover:text-[var(--fg)] transition-colors"
                >
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
