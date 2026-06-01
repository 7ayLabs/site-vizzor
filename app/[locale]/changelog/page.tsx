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
  return (
    <Link
      href={`/changelog/${entry.slug}` as LinkHref}
      className="group flex flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 transition-colors duration-150 hover:border-[var(--accent)]"
    >
      <header className="flex flex-wrap items-baseline gap-3">
        <span className="mono tabular text-lg font-bold text-[var(--fg)]">
          {entry.version}
        </span>
        {entry.codename && (
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
            {entry.codename}
          </span>
        )}
        <span className="mono tabular ml-auto text-[12px] text-[var(--fg-3)]">
          {formatDate(entry.date, locale)}
        </span>
      </header>

      <p className="text-[15px] leading-relaxed text-[var(--fg-2)]">
        {entry.summary}
      </p>

      <span className="text-[13px] font-medium text-[var(--fg-3)] transition-colors duration-150 group-hover:text-[var(--accent)]">
        {readMoreLabel} →
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
