/**
 * Fumadocs source loader.
 *
 * Imports the generated `.source` map produced by `fumadocs-mdx` (the CLI
 * scans `content/docs/`, parses frontmatter, and emits the typed map).
 * Pages are surfaced at the `/docs` base URL — kept outside `[locale]` since
 * docs are English-only for v0.1.0 (see `app/docs/layout.tsx`).
 */
import { docs } from '@/.source';
import { loader } from 'fumadocs-core/source';

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
});
