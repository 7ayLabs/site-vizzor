/**
 * Blog loader — reads MDX files from `content/blog/`, parses frontmatter via
 * gray-matter, and returns typed posts sorted newest-first.
 *
 * The MDX body is kept raw (string) so callers can hand it to either
 * `<MDXRemote>` (page render) or strip it for an RSS description. Filesystem
 * reads happen at request time but Next.js statically caches the result for
 * the dynamic-routes generation pass.
 *
 * ## Locale resolution
 *
 * Posts can ship as English-only (`welcome-to-vizzor.mdx`) or with per-locale
 * translations alongside (`welcome-to-vizzor.es.mdx`, `welcome-to-vizzor.fr.mdx`).
 * Given a `(slug, locale)` pair the loader first looks for
 * `content/blog/<slug>.<locale>.mdx`; if that file is missing it falls back
 * to the canonical English source at `content/blog/<slug>.mdx`. The English
 * source is therefore load-bearing — every post must have one. Tags from
 * the locale file override the English tags when present; if a locale file
 * omits `tags`, the English file's tags are inherited.
 *
 * URL slugs are locale-independent. The base slug (`welcome-to-vizzor`) is
 * the routing identity; the locale segment of the URL (`/es/blog/...`)
 * tells the loader which file to read.
 *
 * Posts carry the union of *editorial* fields (`title`, `author`, `tags`)
 * and *release-notes* fields (`version`, `codename`). The card and the
 * detail page branch on which set is populated; the loader is agnostic.
 *
 * `readingTimeMinutes` is computed once at load against the raw MDX body
 * using a 200-words-per-minute baseline (a conservative editorial figure
 * — Medium, Substack, and most CMS defaults sit in 200–250 wpm). The
 * value is rounded up and floored at 1 so even a paragraph-long post
 * reads as "1 min" rather than "0 min".
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { routing, type Locale } from '@/i18n/routing';

export interface BlogPost {
  /** filename without the .mdx extension (and without any `.<locale>` suffix)
   *  — used as URL slug. Locale-independent. */
  slug: string;
  /** optional semver tag for release-notes posts, e.g. "v0.15.5". */
  version: string;
  /** optional codename for release-notes posts, e.g. "Helios". */
  codename?: string;
  /** ISO 8601 publish date. */
  date: string;
  /**
   * Optional editorial title. When set, the index renders this as the
   * card headline; the version (if any) drops to faint metadata. When
   * absent, the version stays the headline (the default for canonical
   * release-notes entries).
   */
  title?: string;
  /** one-line summary, surfaced in the index and RSS description. */
  summary: string;
  /** byline. Falls back to the rendered "Vizzor team" default at the view layer. */
  author?: string;
  /** short tag list, lowercased at the view layer. Capped to 3 on the card. */
  tags?: readonly string[];
  /** rounded-up reading time in minutes (>= 1), computed from `content`. */
  readingTimeMinutes: number;
  /** raw MDX body — render via next-mdx-remote/rsc. */
  content: string;
}

const DIR = path.join(process.cwd(), 'content/blog');
const WORDS_PER_MINUTE = 200;

/** Validate-and-narrow a string to a known routing locale. */
function isLocale(value: string): value is Locale {
  return (routing.locales as readonly string[]).includes(value);
}

function isMdx(file: string): boolean {
  return file.endsWith('.mdx');
}

/**
 * Word-count heuristic — splits on Unicode whitespace. Frontmatter is
 * already stripped by gray-matter so the input is just the body. Good
 * enough for a reading-time chip; not a substitute for a real readability
 * pass.
 */
function countWords(input: string): number {
  const trimmed = input.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/u).length;
}

function readingTimeMinutes(input: string): number {
  const words = countWords(input);
  if (words === 0) return 1;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

function readTags(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Decompose a filename into `{ baseSlug, locale }`. A filename of
 * `welcome-to-vizzor.es.mdx` yields `{ baseSlug: 'welcome-to-vizzor',
 * locale: 'es' }`; `welcome-to-vizzor.mdx` yields `{ baseSlug:
 * 'welcome-to-vizzor', locale: undefined }`. Only suffixes that match a
 * configured routing locale are treated as a locale tag — any other dot
 * in the basename is preserved as part of the slug.
 */
function parseFilename(
  file: string,
): { baseSlug: string; locale: Locale | undefined } | null {
  if (!isMdx(file)) return null;
  const withoutExt = file.replace(/\.mdx$/, '');
  const lastDot = withoutExt.lastIndexOf('.');
  if (lastDot === -1) {
    return { baseSlug: withoutExt, locale: undefined };
  }
  const candidate = withoutExt.slice(lastDot + 1);
  if (isLocale(candidate)) {
    return {
      baseSlug: withoutExt.slice(0, lastDot),
      locale: candidate,
    };
  }
  return { baseSlug: withoutExt, locale: undefined };
}

interface RawFrontmatter {
  data: Record<string, unknown>;
  content: string;
}

async function readRaw(filePath: string): Promise<RawFrontmatter | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = matter(raw);
    return { data: parsed.data, content: parsed.content };
  } catch {
    return null;
  }
}

/**
 * Build a `BlogPost` for `slug` in the requested `locale`. The locale
 * file (if present) provides the canonical content; any frontmatter
 * field omitted by the locale file falls back to the English source.
 * `tags` follows the same fallback: a locale file with no `tags` key
 * inherits the English tag list rather than dropping it.
 *
 * Returns `null` when no English source exists for the slug.
 */
async function buildPost(
  baseSlug: string,
  locale: Locale,
): Promise<BlogPost | null> {
  const englishPath = path.join(DIR, `${baseSlug}.mdx`);
  const englishRaw = await readRaw(englishPath);
  if (!englishRaw) return null;

  const localeRaw =
    locale === routing.defaultLocale
      ? null
      : await readRaw(path.join(DIR, `${baseSlug}.${locale}.mdx`));

  const source = localeRaw ?? englishRaw;

  const tagsRaw = source.data['tags'];
  const tags =
    tagsRaw !== undefined ? readTags(tagsRaw) : readTags(englishRaw.data['tags']);

  return {
    slug: baseSlug,
    version: String(source.data['version'] ?? englishRaw.data['version'] ?? ''),
    codename:
      source.data['codename'] !== undefined
        ? String(source.data['codename'])
        : englishRaw.data['codename'] !== undefined
          ? String(englishRaw.data['codename'])
          : undefined,
    date: String(source.data['date'] ?? englishRaw.data['date'] ?? ''),
    title:
      source.data['title'] !== undefined
        ? String(source.data['title'])
        : englishRaw.data['title'] !== undefined
          ? String(englishRaw.data['title'])
          : undefined,
    summary: String(source.data['summary'] ?? englishRaw.data['summary'] ?? ''),
    author:
      source.data['author'] !== undefined
        ? String(source.data['author'])
        : englishRaw.data['author'] !== undefined
          ? String(englishRaw.data['author'])
          : undefined,
    tags,
    readingTimeMinutes: readingTimeMinutes(source.content),
    content: source.content,
  };
}

/**
 * Enumerate every post in the requested locale, sorted newest-first.
 * Defaults to the routing default locale (English) so legacy callers
 * — e.g. the global RSS feed — keep working untouched.
 */
export async function getAllPosts(
  locale: Locale = routing.defaultLocale,
): Promise<BlogPost[]> {
  let files: string[];
  try {
    files = await fs.readdir(DIR);
  } catch {
    return [];
  }

  // Dedup by base slug — both `welcome-to-vizzor.mdx` and
  // `welcome-to-vizzor.es.mdx` map to the same logical post.
  const baseSlugs = new Set<string>();
  for (const file of files) {
    const parsed = parseFilename(file);
    if (!parsed) continue;
    baseSlugs.add(parsed.baseSlug);
  }

  const posts = await Promise.all(
    Array.from(baseSlugs).map((slug) => buildPost(slug, locale)),
  );

  return posts
    .filter((p): p is BlogPost => p !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Resolve a single post by its base slug. Returns `null` if no English
 * source exists for that slug, regardless of locale.
 */
export async function getPost(
  slug: string,
  locale: Locale = routing.defaultLocale,
): Promise<BlogPost | null> {
  return buildPost(slug, locale);
}
