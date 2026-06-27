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
  BookOpen,
  Code2,
  FileText,
  History,
  Lock,
  MessagesSquare,
  Receipt,
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
];

const COMMUNITY: readonly FooterItem[] = [
  { href: 'https://t.me/vizzorlabs', key: 'telegramChannel', external: true },
  { href: 'https://discord.gg/sz7AR2Vab', key: 'discord', external: true },
  { href: 'https://chat.whatsapp.com/FdMSZq9M02N7Nw1NcaftIV?mode=gi_t', key: 'whatsapp', external: true },
  { href: 'https://x.com/vizzorlabs', key: 'x', external: true },
];

const RESOURCES: readonly FooterItem[] = [
  { href: '/docs/quickstart', key: 'quickstart' },
  { href: '/docs/chronovisor', key: 'chronovisor' },
  { href: '/docs', key: 'docsIndex' },
];

// Lucide doesn't expose a brand-correct WhatsApp glyph. For brand
// recognition we ship an inline SVG of the official speech-bubble +
// handset mark; everything else stays on lucide for visual coherence.
function WhatsAppIcon({
  size = 14,
  strokeWidth: _strokeWidth = 1.75,
}: {
  size?: number;
  strokeWidth?: number;
}): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.768.966-.94 1.164-.174.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479s1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.71.306 1.263.489 1.695.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12.05 21.785h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.511-5.26c.002-5.45 4.436-9.884 9.888-9.884a9.825 9.825 0 016.992 2.897 9.825 9.825 0 012.894 6.994c-.003 5.45-4.437 9.885-9.889 9.885zm8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.336 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

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
};

const COMMUNITY_ICONS: Record<string, LucideIcon> = {
  telegramChannel: Send,
  discord: MessagesSquare,
  whatsapp: WhatsAppIcon,
  x: Twitter,
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
            }}
            icons={PROJECT_ICONS}
          />
          <FooterCol
            title={t('columns.community.title')}
            items={COMMUNITY}
            labels={{
              telegramChannel: t('columns.community.telegramChannel'),
              discord: t('columns.community.discord'),
              whatsapp: t('columns.community.whatsapp'),
              x: t('columns.community.x'),
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
