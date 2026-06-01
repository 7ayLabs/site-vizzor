/**
 * Fumadocs search route — Orama-backed full-text search over the /docs zone.
 *
 * The client lives inside Fumadocs' `RootProvider`; it calls this endpoint
 * automatically. `createFromSource(source)` snapshots the MDX content map at
 * build time and serves a pre-tokenised index.
 *
 * This route is intentionally NOT excluded from the middleware matcher (the
 * matcher exempts `/api`, `/_next`, `/_vercel`, `/docs`), so locale rewrites
 * never touch it.
 */
import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

export const { GET } = createFromSource(source);
