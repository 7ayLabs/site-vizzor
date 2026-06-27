/**
 * Blog loader — reads MDX files from `content/blog/`, parses frontmatter via
 * gray-matter, and returns typed posts sorted newest-first.
 *
 * The MDX body is kept raw (string) so callers can hand it to either
 * `<MDXRemote>` (page render) or strip it for an RSS description. Filesystem
 * reads happen at request time but Next.js statically caches the result for
 * the dynamic-routes generation pass.
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

export interface BlogPost {
  /** filename without the .mdx extension — used as URL slug. */
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

async function readPost(file: string): Promise<BlogPost> {
  const raw = await fs.readFile(path.join(DIR, file), 'utf-8');
  const { data, content } = matter(raw);
  return {
    slug: file.replace(/\.mdx$/, ''),
    version: String(data['version'] ?? ''),
    codename: data['codename'] ? String(data['codename']) : undefined,
    date: String(data['date'] ?? ''),
    title: data['title'] ? String(data['title']) : undefined,
    summary: String(data['summary'] ?? ''),
    author: data['author'] ? String(data['author']) : undefined,
    tags: readTags(data['tags']),
    readingTimeMinutes: readingTimeMinutes(content),
    content,
  };
}

export async function getAllPosts(): Promise<BlogPost[]> {
  let files: string[];
  try {
    files = await fs.readdir(DIR);
  } catch {
    return [];
  }
  const posts = await Promise.all(files.filter(isMdx).map(readPost));
  return posts.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getPost(slug: string): Promise<BlogPost | null> {
  const all = await getAllPosts();
  return all.find((p) => p.slug === slug) ?? null;
}
