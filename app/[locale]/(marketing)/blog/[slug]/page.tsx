/**
 * /blog/[slug] — post detail.
 *
 * Renders the MDX body via `next-mdx-remote/rsc` with our atoms exposed as
 * custom components, so any post can drop in a TerminalBlock or a
 * CopyChip without any extra wiring. 58ch reading column.
 *
 * Header shape:
 *   - Editorial posts (`title` set) lead with the title, then a byline
 *     strip (author + date + reading time), then the summary.
 *   - Release-notes posts (no `title`) keep the version/codename badge
 *     pair and the version/released/codename SlugTiles so a release
 *     note still reads as a release note.
 * Tags, when declared, render as a pill row at the bottom of the post.
 *
 * Static params are generated for every post x every locale.
 */

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MDXRemote } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import { Clock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { TerminalBlock } from '@/components/ui/terminal-block';
import { CopyChip } from '@/components/ui/copy-chip';
import { CtaPrimary } from '@/components/ui/cta-primary';
import { CtaSecondary } from '@/components/ui/cta-secondary';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { routing } from '@/i18n/routing';
import { getAllPosts, getPost } from '@/lib/blog';

const DEFAULT_AUTHOR = 'Vizzor team';

interface SlugTileProps {
  label: string;
  value: string;
}

function SlugTile({ label, value }: SlugTileProps) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--fg-3)]">
        {label}
      </div>
      <div className="mono tabular text-[15px] font-bold text-[var(--fg)]">
        {value}
      </div>
    </div>
  );
}

const MDX_COMPONENTS = {
  TerminalBlock,
  CopyChip,
  CtaPrimary,
  CtaSecondary,
  SectionEyebrow,
  // Prose overrides so MDX <h2>/<h3>/<ul>/etc. inherit the editorial type system.
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2
      className="mt-12 text-2xl font-bold tracking-tight text-[var(--fg)]"
      {...props}
    />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3
      className="mt-8 text-xl font-semibold tracking-tight text-[var(--fg)]"
      {...props}
    />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p
      className="mt-4 text-[16px] leading-[1.7] text-[var(--fg)]"
      {...props}
    />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul
      className="mt-4 flex list-disc flex-col gap-2 pl-6 text-[16px] leading-[1.7] text-[var(--fg)] marker:text-[var(--accent)]"
      {...props}
    />
  ),
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
    <ol
      className="mt-4 flex list-decimal flex-col gap-2 pl-6 text-[16px] leading-[1.7] text-[var(--fg)] marker:text-[var(--accent)]"
      {...props}
    />
  ),
  li: (props: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="leading-[1.7]" {...props} />
  ),
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      className="text-[var(--accent)] underline-offset-4 hover:underline"
      {...props}
    />
  ),
  code: (props: React.HTMLAttributes<HTMLElement>) => (
    <code
      className="mono rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[0.9em] text-[var(--fg)]"
      {...props}
    />
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-[var(--fg)]" {...props} />
  ),
  hr: () => <hr className="my-10 border-[var(--border)]" />,
};

export async function generateStaticParams(): Promise<
  Array<{ locale: string; slug: string }>
> {
  const posts = await getAllPosts();
  return routing.locales.flatMap((locale) =>
    posts.map((p) => ({ locale, slug: p.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return {};
  const title =
    post.title ?? `${post.version}${post.codename ? ` · ${post.codename}` : ''}`;
  return {
    title,
    description: post.summary,
    openGraph: { title, description: post.summary, type: 'article' },
  };
}

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

export default async function BlogDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const post = await getPost(slug);
  if (!post) notFound();

  const t = await getTranslations('blog');
  const isEditorial = !!post.title;
  const author = post.author ?? DEFAULT_AUTHOR;
  // Proper next-intl ICU interpolation — `.replace()` on the raw
  // template silently broke when the underlying string ever picked up
  // a real ICU plural / select clause (e.g. "1 min read" vs "n min read").
  const readingTime = t('readingTime', { minutes: post.readingTimeMinutes });

  return (
    <section className="relative">
      <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
        {/* Breadcrumb */}
        <div className="mb-10">
          <Link
            href="/blog"
            className="mono text-[12px] text-[var(--fg-3)] transition-colors duration-150 hover:text-[var(--fg)]"
          >
            ← {t('blogTitle')}
          </Link>
        </div>

        <article className="mx-auto max-w-[58ch]">
          <header className="flex flex-col gap-5">
            {isEditorial ? (
              <>
                <h1 className="display text-[32px] sm:text-[40px] leading-[1.1] tracking-tight font-semibold text-[var(--fg)]">
                  {post.title}
                </h1>
                {/* Byline strip — author · date · reading time. Mono +
                    tabular so the dot separators line up cleanly with
                    the index card variant. */}
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-[var(--fg-3)]">
                  <span className="mono tabular font-semibold text-[var(--fg-2)]">
                    {author}
                  </span>
                  <span aria-hidden className="text-[var(--border)]">·</span>
                  <time className="mono tabular" dateTime={post.date}>
                    {formatDate(post.date, locale)}
                  </time>
                  <span aria-hidden className="text-[var(--border)]">·</span>
                  <span className="mono tabular inline-flex items-center gap-1">
                    <Clock size={11} strokeWidth={1.75} aria-hidden />
                    {readingTime}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="mono tabular text-[28px] font-bold leading-none text-[var(--fg)]">
                    {post.version}
                  </span>
                  {post.codename && (
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
                      {post.codename}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <SlugTile
                    label={t('meta.released')}
                    value={formatDate(post.date, locale)}
                  />
                  <SlugTile label={t('meta.version')} value={post.version} />
                  {post.codename && (
                    <SlugTile label={t('meta.codename')} value={post.codename} />
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-[var(--fg-3)]">
                  <span className="mono tabular font-semibold text-[var(--fg-2)]">
                    {author}
                  </span>
                  <span aria-hidden className="text-[var(--border)]">·</span>
                  <span className="mono tabular inline-flex items-center gap-1">
                    <Clock size={11} strokeWidth={1.75} aria-hidden />
                    {readingTime}
                  </span>
                </div>
              </>
            )}

            <p className="mt-3 text-[17px] leading-relaxed text-[var(--fg-2)]">
              {post.summary}
            </p>
          </header>

          <hr className="my-10 border-[var(--border)]" />

          <div className="flex flex-col">
            <MDXRemote
              source={post.content}
              components={MDX_COMPONENTS}
              options={{
                mdxOptions: {
                  remarkPlugins: [remarkGfm],
                  rehypePlugins: [
                    rehypeSlug,
                    [
                      rehypeAutolinkHeadings,
                      { behavior: 'wrap', properties: { className: ['anchor'] } },
                    ],
                  ],
                },
              }}
            />
          </div>

          {post.tags && post.tags.length > 0 && (
            <footer className="mt-12 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-6">
              <span className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
                {t('tagsLabel')}
              </span>
              <ul className="flex flex-wrap items-center gap-1.5" aria-label={t('tagsLabel')}>
                {post.tags.map((tag) => (
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
            </footer>
          )}
        </article>
      </div>
    </section>
  );
}
