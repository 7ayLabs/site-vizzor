/**
 * /changelog/feed.xml — single global RSS 2.0 feed in English.
 *
 * Sits outside [locale] because feed readers expect a stable, unprefixed URL.
 * The middleware matcher excludes any path containing a dot, so this route
 * bypasses locale negotiation entirely.
 *
 * Force-static: feed contents change only at build time alongside the MDX
 * source files; we generate once and serve from the CDN edge.
 */

import { NextResponse } from 'next/server';
import { getAllChangelog } from '@/lib/changelog';

export const dynamic = 'force-static';

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const SITE_URL = 'https://vizzor.ai';

export async function GET() {
  const entries = await getAllChangelog();

  const items = entries
    .map((e) => {
      const title = escapeXml(
        `${e.version}${e.codename ? ` · ${e.codename}` : ''}`,
      );
      const url = `${SITE_URL}/changelog/${e.slug}`;
      const pubDate = e.date
        ? new Date(e.date).toUTCString()
        : new Date().toUTCString();
      return `    <item>
      <title>${title}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[${e.summary}]]></description>
    </item>`;
    })
    .join('\n');

  const latest = entries[0];
  const lastBuild = latest?.date
    ? new Date(latest.date).toUTCString()
    : new Date().toUTCString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Vizzor Changelog</title>
    <link>${SITE_URL}/changelog</link>
    <atom:link href="${SITE_URL}/changelog/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Versioned release notes for Vizzor.</description>
    <language>en</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
${items}
  </channel>
</rss>
`;

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
