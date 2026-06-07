/**
 * Docs-zone route loader.
 *
 * Mirrors the locale-scoped loader so navigations into / between
 * `/docs/*` routes also surface the Vizzor brand-mark loader during
 * the brief window the new page is server-rendering. The shared
 * `<VizzorLoader>` component reads its animations from `docs.css`,
 * which mirrors the same utilities defined in `app/globals.css`.
 */

import { VizzorLoader } from '@/components/layout/vizzor-loader';

export default function Loading() {
  return <VizzorLoader />;
}
