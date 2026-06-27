/**
 * WhatsInIt — "One call. Full receipts." + a per-surface frame trio
 * showing where you can actually run it.
 *
 * The headline + 3 bullets stay (they describe what ships per call).
 * Below them, a small `surfacesEyebrow` ("where you use it") introduces
 * three monochrome frames — Telegram, CLI, Web — each with:
 *   - A 56px rounded-square icon well (--surface-2 bg, hairline border)
 *   - Title (small heading)
 *   - One-line description
 *   - A quiet, underline-on-hover link to the surface
 *
 * Why merged here: the previous pass added a standalone `<AvailableOn />`
 * section that duplicated the same Telegram/CLI/Web idea downstream of
 * `<SurfaceCompare />`. Folding the surface index into `WhatsInIt` keeps
 * the page rhythm and removes the duplication without losing the i18n
 * copy.
 *
 * Server component — no client interactivity beyond the link targets.
 * Lucide icons render to inline SVG, so the section pays zero hydration
 * cost. Hover lift + 1px translate are CSS-only and gated by the
 * `motion-safe:` variant (which compiles down to a
 * `prefers-reduced-motion: no-preference` media query) so reduced-motion
 * users get the static frame.
 *
 * Translation namespace: `whatsInIt` (existing) + `whatsInIt.surfaces.*`
 * + `whatsInIt.surfacesEyebrow` (new).
 */
import { getTranslations } from 'next-intl/server';
import { Check, Globe, Send, Terminal } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { getAppLinkTarget } from '@/lib/app-url';
import { cn } from '@/lib/utils';

const TELEGRAM_URL = 'https://t.me/vizzorai_bot';
const CLI_DOCS_PATH = '/docs/cli';

type SurfaceKey = 'telegram' | 'cli' | 'web';

type SurfaceLink =
  | { kind: 'external'; href: string }
  | { kind: 'internal'; href: '/app/predict' | '/docs/cli' };

interface SurfaceSpec {
  key: SurfaceKey;
  /** Lucide icon component (kept untyped at the import boundary so we
   *  don't carry the full `LucideIcon` interface for one prop). */
  Icon: React.ComponentType<{
    'aria-hidden'?: boolean;
    className?: string;
    strokeWidth?: number;
    size?: number;
  }>;
  link: SurfaceLink;
}

export async function WhatsInIt() {
  const t = await getTranslations('whatsInIt');
  const appLink = getAppLinkTarget();

  const surfaces: readonly SurfaceSpec[] = [
    { key: 'telegram', Icon: Send, link: { kind: 'external', href: TELEGRAM_URL } },
    { key: 'cli', Icon: Terminal, link: { kind: 'internal', href: CLI_DOCS_PATH } },
    {
      key: 'web',
      Icon: Globe,
      link: appLink.external
        ? { kind: 'external', href: appLink.href }
        : { kind: 'internal', href: appLink.href as '/app/predict' },
    },
  ];

  return (
    <section
      aria-labelledby="whats-in-it-title"
      className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-20 md:py-28 lg:py-32"
    >
      {/* ── Copy band: headline + bullets ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12">
        <div className="lg:col-span-7">
          <GsapHeadline
            eyebrow={
              <span className="mono tabular text-[11px] tracking-[0.22em] uppercase text-[var(--fg-3)]">
                {t('eyebrow')}
              </span>
            }
            title={t('title')}
            sub={t('sub')}
            titleId="whats-in-it-title"
            titleClassName="display text-[var(--fg)] text-balance text-[28px] sm:text-[36px] lg:text-[44px] leading-[1.05] tracking-[-0.02em] font-semibold mt-4"
            subClassName="mt-5 text-[15px] sm:text-[16px] leading-relaxed text-[var(--fg-2)] max-w-[52ch]"
          />
        </div>

        <ul className="lg:col-span-5 flex flex-col gap-2.5 self-end">
          {(['directional', 'targets', 'snapshot'] as const).map((k) => (
            <li
              key={k}
              className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
            >
              <Check
                size={16}
                strokeWidth={2}
                className="mt-[3px] flex-none text-[var(--fg)]"
                aria-hidden
              />
              <span className="text-[13.5px] text-[var(--fg)] leading-relaxed">
                {t(`bullets.${k}`)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Surface frames: where you actually use it ──────────────── */}
      <div className="mt-14 flex items-center gap-3">
        <span
          aria-hidden
          className="inline-block h-px w-6 bg-[var(--accent)]"
        />
        <span className="mono tabular text-[10.5px] uppercase tracking-[0.2em] text-[var(--fg-3)]">
          {t('surfacesEyebrow')}
        </span>
      </div>

      <ul
        className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5"
        aria-label="Vizzor surfaces"
      >
        {surfaces.map((s) => (
          <SurfaceFrame
            key={s.key}
            icon={
              <s.Icon
                aria-hidden
                size={28}
                strokeWidth={1.5}
                className="text-[var(--fg)]"
              />
            }
            title={t(`surfaces.${s.key}.title`)}
            description={t(`surfaces.${s.key}.description`)}
            cta={t(`surfaces.${s.key}.cta`)}
            link={s.link}
          />
        ))}
      </ul>

      {/* ── Quiet "see the math" trail ─────────────────────────────── */}
      <div className="mt-10">
        <Link
          href="/docs/chronovisor"
          className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-[var(--fg)] underline-offset-4 hover:underline"
        >
          <span>{t('learnMore')}</span>
          <span aria-hidden>→</span>
        </Link>
      </div>
    </section>
  );
}

/* ─────────────────────────── surface frame ─────────────────────────── */

interface SurfaceFrameProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
  link: SurfaceLink;
}

function SurfaceFrame({
  icon,
  title,
  description,
  cta,
  link,
}: SurfaceFrameProps) {
  // The whole card is the link surface. The full clickable region keeps
  // the keyboard target large and the hit area aligned with the visual.
  const cardClass = cn(
    'group relative flex flex-col gap-4',
    'rounded-2xl border border-[var(--border)] bg-[var(--surface)]',
    'p-5 sm:p-6 h-full',
    'shadow-[inset_0_1px_0_0_color-mix(in_oklab,var(--fg)_4%,transparent)]',
    'transition-[transform,border-color,box-shadow] duration-300 ease-out',
    'hover:border-[var(--fg-3)]',
    'hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.25),inset_0_1px_0_0_color-mix(in_oklab,var(--fg)_6%,transparent)]',
    'motion-safe:hover:[transform:translateY(-1px)]',
    'focus-visible:outline-none focus-visible:ring-2',
    'focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2',
    'focus-visible:ring-offset-[var(--bg)]',
  );

  const inner = (
    <>
      {/* Icon well — 56px rounded square, --surface-2 bg, hairline border */}
      <span
        aria-hidden
        className="
          inline-flex h-14 w-14 items-center justify-center
          rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]
        "
      >
        {icon}
      </span>

      <div className="flex flex-col gap-1.5">
        <h3 className="display text-[18px] sm:text-[20px] leading-[1.1] tracking-[-0.01em] font-semibold text-[var(--fg)]">
          {title}
        </h3>
        <p className="text-[13.5px] leading-relaxed text-[var(--fg-2)]">
          {description}
        </p>
      </div>

      <span
        className="
          mt-auto inline-flex items-center gap-1.5
          text-[12.5px] font-medium text-[var(--fg-2)]
          group-hover:text-[var(--fg)] transition-colors
        "
      >
        <span className="underline-offset-4 group-hover:underline">{cta}</span>
        <span
          aria-hidden
          className="transition-transform duration-200 ease-out group-hover:translate-x-0.5"
        >
          {link.kind === 'external' ? '↗' : '→'}
        </span>
      </span>
    </>
  );

  return (
    <li className="h-full">
      {link.kind === 'external' ? (
        <a
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${cta} (opens in a new tab)`}
          className={cardClass}
        >
          {inner}
        </a>
      ) : (
        <Link href={link.href} className={cardClass} aria-label={cta}>
          {inner}
        </Link>
      )}
    </li>
  );
}
