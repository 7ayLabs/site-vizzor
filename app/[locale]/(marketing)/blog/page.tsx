/**
 * /blog — editorial + release-notes index, reverse-chronological.
 *
 * Each post renders as a card. The metadata strip shows the author (or
 * "Vizzor team" fallback), publish date, and reading-time chip; the
 * summary sits below the headline; up to three lowercased tag pills
 * line up under the summary when the frontmatter declares any.
 *
 * Release-notes posts (no editorial `title` field) keep the version as
 * their headline — the same PostCard renders both shapes.
 *
 * The RSS link sits in the page header, right side, so any operator who
 * wants push gets it without scrolling.
 */

import type { ComponentProps } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Rss, Clock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { MotionReveal } from '@/components/ui/motion-reveal';
import { routing, type Locale } from '@/i18n/routing';
import { getAllPosts, type BlogPost } from '@/lib/blog';

function toLocale(value: string): Locale {
  return (routing.locales as readonly string[]).includes(value)
    ? (value as Locale)
    : routing.defaultLocale;
}

type LinkHref = ComponentProps<typeof Link>['href'];

const DEFAULT_AUTHOR = 'Vizzor team';
const MAX_TAGS = 3;

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

function PostCard({
  post,
  locale,
  readMoreLabel,
  readingTimeLabel,
}: {
  post: BlogPost;
  locale: string;
  readMoreLabel: string;
  /** Pre-interpolated reading-time string for this post (already
   *  resolved through next-intl ICU). PostCard renders it as-is. */
  readingTimeLabel: string;
}) {
  const headline = post.title ?? post.version;
  const isEditorial = !!post.title;
  const author = post.author ?? DEFAULT_AUTHOR;
  const tags = post.tags?.slice(0, MAX_TAGS) ?? [];

  return (
    <Link
      href={`/blog/${post.slug}` as LinkHref}
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
      {/* Top metadata strip — avatar dot · author · date · reading time.
          Release-notes posts (no editorial `title`) still surface their
          version as the headline below; the metadata strip stays
          identical so the index reads as one consistent vertical rhythm
          regardless of the post shape. */}
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-[var(--fg-3)]">
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
          {author}
        </span>
        {post.codename && (
          <span className="hidden sm:inline mono tabular uppercase tracking-[0.12em] text-[10.5px] text-[var(--fg-3)]">
            · {post.codename}
          </span>
        )}
        <span aria-hidden className="mx-1 text-[var(--border)]">·</span>
        <time className="mono tabular text-[var(--fg-3)]" dateTime={post.date}>
          {formatDate(post.date, locale)}
        </time>
        <span aria-hidden className="mx-1 text-[var(--border)]">·</span>
        <span className="mono tabular inline-flex items-center gap-1 text-[var(--fg-3)]">
          <Clock size={11} strokeWidth={1.75} aria-hidden />
          {readingTimeLabel}
        </span>
      </header>

      {/* Headline — title takes the slot when present, otherwise the
          version steps up. Editorial posts read like blog posts; release
          notes read like the mono version chips they always were. */}
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
        {post.summary}
      </p>

      {tags.length > 0 && (
        <ul
          className="flex flex-wrap items-center gap-1.5"
          aria-label="Tags"
        >
          {tags.map((tag) => (
            <li
              key={tag}
              className="
                mono tabular inline-flex items-center
                rounded-full border border-[var(--border)]
                bg-[var(--surface-2)] px-2 py-0.5
                text-[10.5px] lowercase tracking-[0.04em]
                text-[var(--fg-3)]
              "
            >
              {tag.toLowerCase()}
            </li>
          ))}
        </ul>
      )}

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

export default async function BlogIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('blog');
  const posts = await getAllPosts(toLocale(locale));

  return (
    <section className="relative">
      <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-16 lg:py-32">
        <div className="flex items-start justify-between gap-6">
          <GsapHeadline
            as="h1"
            className="flex max-w-[42ch] flex-col gap-4"
            eyebrow={<SectionEyebrow>{t('blogEyebrow')}</SectionEyebrow>}
            title={t('blogTitle')}
            sub={t('blogSub')}
            titleClassName="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-[var(--fg)]"
            subClassName="mt-4 text-[var(--fg-2)] leading-relaxed max-w-[58ch]"
          />

          <a
            href="/blog/feed.xml"
            className="mono inline-flex shrink-0 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-1.5 text-[12px] text-[var(--fg-2)] transition-colors duration-150 hover:border-[var(--accent)] hover:text-[var(--accent)]"
            aria-label={t('subscribeRss')}
          >
            <Rss size={14} strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">{t('subscribeRss')}</span>
            <span className="sm:hidden">RSS</span>
          </a>
        </div>

        <div className="mt-14 flex flex-col gap-5">
          {posts.length === 0 ? (
            <p className="text-[var(--fg-3)]">{t('empty')}</p>
          ) : (
            posts.map((post, idx) => (
              <MotionReveal key={post.slug} delay={idx * 60}>
                <PostCard
                  post={post}
                  locale={locale}
                  readMoreLabel={t('readMore')}
                  // Interpolate per-post via proper next-intl ICU so the
                  // string is render-ready (no `.replace('{minutes}', …)`
                  // fallback that breaks on plural/select clauses).
                  readingTimeLabel={t('readingTime', {
                    minutes: post.readingTimeMinutes,
                  })}
                />
              </MotionReveal>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
