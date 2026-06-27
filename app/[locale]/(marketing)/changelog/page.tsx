/**
 * /changelog — release notes index, reverse-chronological.
 *
 * Each entry is a card; the version/codename/date header sits over a short
 * summary, with a "Read full notes →" link to the detail page. The RSS link
 * sits in the page header, right side, so any operator who wants push gets
 * it without scrolling.
 */

import type { ComponentProps } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Rss } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { MotionReveal } from '@/components/ui/motion-reveal';
import { getAllChangelog, type ChangelogEntry } from '@/lib/changelog';

type LinkHref = ComponentProps<typeof Link>['href'];

function formatDate(iso: string, locale: string): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function EntryCard({
  entry,
  locale,
  readMoreLabel,
}: {
  entry: ChangelogEntry;
  locale: string;
  readMoreLabel: string;
}) {
  const headline = entry.title ?? entry.version;
  const isEditorial = !!entry.title;

  return (
    <Link
      href={`/changelog/${entry.slug}` as LinkHref}
      className="
        group flex flex-col gap-3 rounded-2xl
        border border-[var(--border)] bg-[var(--surface)]
        p-6 sm:p-7
        transition-[border-color,transform,box-shadow] duration-200 ease-out
        hover:border-[var(--fg-3)] hover:-translate-y-0.5
        hover:shadow-[0_8px_24px_-12px_color-mix(in_oklab,var(--fg)_18%,transparent)]
        focus-visible:outline-none focus-visible:ring-2
        focus-visible:ring-[var(--fg)] focus-visible:ring-offset-2
        focus-visible:ring-offset-[var(--bg)]
      "
    >
      {/* Top metadata strip — avatar dot + version + codename + date.
          For editorial posts (a `title` field set), the version becomes
          quiet metadata and the title takes the headline slot below.
          For canonical release-notes entries (no title), the headline
          IS the version and this strip just shows codename + date. */}
      <header className="flex items-center gap-2.5 text-[12px] text-[var(--fg-3)]">
        <span
          aria-hidden
          className="
            inline-flex h-7 w-7 shrink-0 items-center justify-center
            rounded-full border border-[var(--border)]
            bg-[var(--surface-2)]
            text-[10px] font-bold tracking-tight text-[var(--fg-2)]
          "
        >
          V
        </span>
        <span className="mono tabular truncate font-semibold text-[var(--fg-2)]">
          Vizzor
        </span>
        {isEditorial && (
          <span className="mono tabular text-[var(--fg-3)]">
            · <span className="text-[var(--fg-2)]">{entry.version}</span>
          </span>
        )}
        {entry.codename && (
          <span className="hidden sm:inline mono tabular uppercase tracking-[0.12em] text-[10.5px] text-[var(--fg-3)]">
            · {entry.codename}
          </span>
        )}
        <span aria-hidden className="mx-1 text-[var(--border)]">·</span>
        <time className="mono tabular text-[var(--fg-3)]" dateTime={entry.date}>
          {formatDate(entry.date, locale)}
        </time>
      </header>

      {/* Headline — title takes the slot when present, otherwise the
          version steps up. Sized like a real post headline (not a
          mono-version chip) so editorial posts read like blog posts. */}
      <h2
        className={
          isEditorial
            ? 'display text-[22px] sm:text-[26px] leading-[1.15] tracking-tight font-semibold text-[var(--fg)]'
            : 'mono tabular text-[20px] sm:text-[22px] leading-none font-bold tracking-tight text-[var(--fg)]'
        }
      >
        {headline}
      </h2>

      <p className="text-[14.5px] leading-relaxed text-[var(--fg-2)] max-w-[64ch]">
        {entry.summary}
      </p>

      {/* Subtle CTA — single chevron + label, no chunky button. The
          whole card is already the click target; this is just the
          visible affordance. */}
      <span
        className="
          mt-1 inline-flex items-center gap-1
          text-[12.5px] font-medium text-[var(--fg-3)]
          transition-colors duration-150
          group-hover:text-[var(--fg)]
        "
      >
        <span>{readMoreLabel}</span>
        <span
          aria-hidden
          className="transition-transform duration-200 ease-out group-hover:translate-x-0.5"
        >
          →
        </span>
      </span>
    </Link>
  );
}

export default async function ChangelogIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('changelog');
  const entries = await getAllChangelog();

  return (
    <section className="relative">
      <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-16 lg:py-32">
        <div className="flex items-start justify-between gap-6">
          <GsapHeadline
            as="h1"
            className="flex max-w-[42ch] flex-col gap-4"
            eyebrow={<SectionEyebrow>{t('changelogEyebrow')}</SectionEyebrow>}
            title={t('changelogTitle')}
            sub={t('changelogSub')}
            titleClassName="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-[var(--fg)]"
            subClassName="mt-4 text-[var(--fg-2)] leading-relaxed max-w-[58ch]"
          />

          <a
            href="/changelog/feed.xml"
            className="mono inline-flex shrink-0 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-1.5 text-[12px] text-[var(--fg-2)] transition-colors duration-150 hover:border-[var(--accent)] hover:text-[var(--accent)]"
            aria-label={t('subscribeRss')}
          >
            <Rss size={14} strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">{t('subscribeRss')}</span>
            <span className="sm:hidden">RSS</span>
          </a>
        </div>

        <div className="mt-14 flex flex-col gap-5">
          {entries.length === 0 ? (
            <p className="text-[var(--fg-3)]">{t('empty')}</p>
          ) : (
            entries.map((entry, idx) => (
              <MotionReveal key={entry.slug} delay={idx * 60}>
                <EntryCard
                  entry={entry}
                  locale={locale}
                  readMoreLabel={t('readMore')}
                />
              </MotionReveal>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
