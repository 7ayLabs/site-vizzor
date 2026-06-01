/**
 * Changelog loader — reads MDX files from `content/changelog/`, parses
 * frontmatter via gray-matter, and returns typed entries sorted newest-first.
 *
 * The MDX body is kept raw (string) so callers can hand it to either
 * `<MDXRemote>` (page render) or strip it for an RSS description. Filesystem
 * reads happen at request time but Next.js statically caches the result for
 * the dynamic-routes generation pass.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

export interface ChangelogEntry {
  /** filename without the .mdx extension — used as URL slug. */
  slug: string;
  /** semver tag, e.g. "v0.15.5". */
  version: string;
  /** optional codename, e.g. "Helios". */
  codename?: string;
  /** ISO 8601 release date. */
  date: string;
  /** one-line summary, surfaced in the index and RSS description. */
  summary: string;
  /** raw MDX body — render via next-mdx-remote/rsc. */
  content: string;
}

const DIR = path.join(process.cwd(), 'content/changelog');

function isMdx(file: string): boolean {
  return file.endsWith('.mdx');
}

async function readEntry(file: string): Promise<ChangelogEntry> {
  const raw = await fs.readFile(path.join(DIR, file), 'utf-8');
  const { data, content } = matter(raw);
  return {
    slug: file.replace(/\.mdx$/, ''),
    version: String(data['version'] ?? ''),
    codename: data['codename'] ? String(data['codename']) : undefined,
    date: String(data['date'] ?? ''),
    summary: String(data['summary'] ?? ''),
    content,
  };
}

export async function getAllChangelog(): Promise<ChangelogEntry[]> {
  let files: string[];
  try {
    files = await fs.readdir(DIR);
  } catch {
    return [];
  }
  const entries = await Promise.all(files.filter(isMdx).map(readEntry));
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getChangelog(slug: string): Promise<ChangelogEntry | null> {
  const all = await getAllChangelog();
  return all.find((e) => e.slug === slug) ?? null;
}
