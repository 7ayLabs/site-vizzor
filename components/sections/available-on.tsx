/**
 * AvailableOn — "Wherever you work" surface index.
 *
 * Three slim cards rendered side-by-side on desktop (stacked on mobile),
 * one per surface: Web, Telegram, CLI. Each card is a small monochrome
 * tile with a line icon, a label, a one-line copy block, and a single
 * link target. The CLI tile additionally renders a `<code>` block with
 * the install command so visitors can copy it inline.
 *
 * Server-only component (no client interactivity beyond the link
 * targets) — the icons come from `lucide-react` which renders to inline
 * SVG with no runtime hydration cost.
 *
 * Layout sits BEFORE `<CtaBlock />` in the page composition (acts as
 * the surface index that the closing CTA then converts on).
 *
 * Translation namespace: `availableOn`.
 */
import { getTranslations } from 'next-intl/server';
import { Globe, Send, Terminal } from 'lucide-react';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { Link } from '@/i18n/navigation';
import { getAppLinkTarget } from '@/lib/app-url';

const TELEGRAM_URL = 'https://t.me/vizzorai_bot';
const CLI_INSTALL_COMMAND = 'npx vizzor';

export async function AvailableOn() {
  const t = await getTranslations('availableOn');
  const appLink = getAppLinkTarget();

  return (
    <section
      aria-labelledby="available-on-title"
      className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-20 md:py-28 lg:py-32"
    >
      <GsapHeadline
        className="flex flex-col items-center gap-4 max-w-[60ch] mx-auto text-center"
        eyebrow={<SectionEyebrow align="center">{t('eyebrow')}</SectionEyebrow>}
        title={t('title')}
        sub={t('lede')}
        titleId="available-on-title"
        titleClassName="display text-[var(--fg)] text-balance text-[clamp(28px,5vw,52px)] tracking-tight leading-[1.05] font-semibold"
        subClassName="text-[var(--fg-2)] max-w-[58ch] mx-auto leading-relaxed text-[15px] sm:text-[16px]"
      />

      <ul
        className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6 items-stretch"
        aria-label="Vizzor surfaces"
      >
        {/* ── Web ─────────────────────────────────────────────────── */}
        <SurfaceCard
          icon={<Globe aria-hidden className="h-5 w-5" strokeWidth={1.5} />}
          eyebrow={t('web.eyebrow')}
          title={t('web.title')}
          description={t('web.description')}
          linkLabel={t('web.cta')}
          link={
            appLink.external
              ? { kind: 'external', href: appLink.href }
              : {
                  kind: 'internal',
                  href: appLink.href as '/app/predict',
                }
          }
        />

        {/* ── Telegram ────────────────────────────────────────────── */}
        <SurfaceCard
          icon={<Send aria-hidden className="h-5 w-5" strokeWidth={1.5} />}
          eyebrow={t('telegram.eyebrow')}
          title={t('telegram.title')}
          description={t('telegram.description')}
          linkLabel={t('telegram.cta')}
          link={{ kind: 'external', href: TELEGRAM_URL }}
        />

        {/* ── CLI ─────────────────────────────────────────────────── */}
        <SurfaceCard
          icon={<Terminal aria-hidden className="h-5 w-5" strokeWidth={1.5} />}
          eyebrow={t('cli.eyebrow')}
          title={t('cli.title')}
          description={t('cli.description')}
          linkLabel={t('cli.cta')}
          link={{ kind: 'internal', href: '/docs/cli' }}
          codeBlock={CLI_INSTALL_COMMAND}
        />
      </ul>
    </section>
  );
}

/* ─────────────────────────── surface card ─────────────────────────── */

type SurfaceLink =
  | { kind: 'external'; href: string }
  | { kind: 'internal'; href: '/app/predict' | '/docs/cli' | '/pricing' };

interface SurfaceCardProps {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  linkLabel: string;
  link: SurfaceLink;
  codeBlock?: string;
}

const CARD_CLASS = `
  group relative flex flex-col gap-4
  rounded-2xl border border-[var(--border)] bg-[var(--surface)]
  p-6
  shadow-[0_8px_32px_-16px_rgba(0,0,0,0.18)]
  dark:shadow-[0_8px_32px_-10px_rgba(0,0,0,0.55)]
  transition-[transform,box-shadow,border-color] duration-300 ease-out
  hover:border-[var(--border-hi)]
  hover:shadow-[0_16px_40px_-16px_rgba(0,0,0,0.25)]
  motion-safe:hover:[transform:translateY(-2px)]
  overflow-hidden
`;

function SurfaceCard({
  icon,
  eyebrow,
  title,
  description,
  linkLabel,
  link,
  codeBlock,
}: SurfaceCardProps) {
  return (
    <li className={CARD_CLASS}>
      {/* ── Icon + eyebrow ──────────────────────────────────────── */}
      <header className="flex items-center gap-3">
        <span
          className="
            inline-flex h-10 w-10 items-center justify-center
            rounded-xl border border-[var(--border)] bg-[var(--surface-2)]
            text-[var(--fg)]
          "
        >
          {icon}
        </span>
        <span className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
          {eyebrow}
        </span>
      </header>

      {/* ── Title + description ─────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <h3 className="display text-[20px] sm:text-[22px] leading-[1.1] tracking-[-0.02em] font-semibold text-[var(--fg)]">
          {title}
        </h3>
        <p className="text-[13.5px] leading-relaxed text-[var(--fg-2)]">
          {description}
        </p>
      </div>

      {/* ── Optional code block (CLI tile) ──────────────────────── */}
      {codeBlock && (
        <pre
          className="
            mono tabular text-[12px] text-[var(--fg)]
            rounded-md border border-[var(--border)] bg-[var(--surface-2)]
            px-3 py-2 overflow-x-auto
          "
          aria-label="Install command"
        >
          <code>$ {codeBlock}</code>
        </pre>
      )}

      {/* ── Link target ─────────────────────────────────────────── */}
      <div className="mt-auto pt-2">
        {link.kind === 'external' ? (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${linkLabel} (opens in a new tab)`}
            className="
              inline-flex items-center gap-1.5
              text-[13px] font-medium text-[var(--fg)]
              underline-offset-4 hover:underline
              transition-colors
              focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2
              focus-visible:ring-offset-[var(--bg)]
              rounded-sm
            "
          >
            <span>{linkLabel}</span>
            <span
              aria-hidden
              className="transition-transform duration-150 ease-out group-hover:translate-x-0.5"
            >
              ↗
            </span>
          </a>
        ) : (
          <Link
            href={link.href}
            className="
              inline-flex items-center gap-1.5
              text-[13px] font-medium text-[var(--fg)]
              underline-offset-4 hover:underline
              transition-colors
              focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2
              focus-visible:ring-offset-[var(--bg)]
              rounded-sm
            "
          >
            <span>{linkLabel}</span>
            <span
              aria-hidden
              className="transition-transform duration-150 ease-out group-hover:translate-x-0.5"
            >
              →
            </span>
          </Link>
        )}
      </div>
    </li>
  );
}
