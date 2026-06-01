/**
 * /changelog/[slug] — release notes detail.
 *
 * Renders the MDX body via `next-mdx-remote/rsc` with our atoms exposed as
 * custom components, so a release note can drop in a TerminalBlock or a
 * CopyChip without any extra wiring. 58ch reading column.
 *
 * Static params are generated for every entry × every locale.
 */

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MDXRemote } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import { Link } from '@/i18n/navigation';
import { TerminalBlock } from '@/components/ui/terminal-block';
import { CopyChip } from '@/components/ui/copy-chip';
import { CtaPrimary } from '@/components/ui/cta-primary';
import { CtaSecondary } from '@/components/ui/cta-secondary';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { routing } from '@/i18n/routing';
import { getAllChangelog, getChangelog } from '@/lib/changelog';

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
  const entries = await getAllChangelog();
  return routing.locales.flatMap((locale) =>
    entries.map((e) => ({ locale, slug: e.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const entry = await getChangelog(slug);
  if (!entry) return {};
  const title = `${entry.version}${entry.codename ? ` · ${entry.codename}` : ''}`;
  return {
    title,
    description: entry.summary,
    openGraph: { title, description: entry.summary, type: 'article' },
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

export default async function ChangelogDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const entry = await getChangelog(slug);
  if (!entry) notFound();

  const t = await getTranslations('changelog');

  return (
    <section className="relative">
      <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
        {/* Breadcrumb */}
        <div className="mb-10">
          <Link
            href="/changelog"
            className="mono text-[12px] text-[var(--fg-3)] transition-colors duration-150 hover:text-[var(--fg)]"
          >
            ← {t('changelogTitle')}
          </Link>
        </div>

        <article className="mx-auto max-w-[58ch]">
          <header className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="mono tabular text-[28px] font-bold leading-none text-[var(--fg)]">
                {entry.version}
              </span>
              {entry.codename && (
                <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
                  {entry.codename}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <SlugTile
                label={t('meta.released')}
                value={formatDate(entry.date, locale)}
              />
              <SlugTile label={t('meta.version')} value={entry.version} />
              {entry.codename && (
                <SlugTile label={t('meta.codename')} value={entry.codename} />
              )}
            </div>

            <p className="mt-3 text-[17px] leading-relaxed text-[var(--fg-2)]">
              {entry.summary}
            </p>
          </header>

          <hr className="my-10 border-[var(--border)]" />

          <div className="flex flex-col">
            <MDXRemote
              source={entry.content}
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
        </article>
      </div>
    </section>
  );
}
