/**
 * Locale-scoped route loader.
 *
 * Next.js App Router automatically renders this component while any
 * route segment under `/[locale]/*` is server-rendering — between the
 * click on a link and the moment Next's RSC payload is ready. Combined
 * with the client-side <PageTransition> wrapper in the layout, this
 * gives every intra-site navigation a smooth: brand-loader → fade-in
 * sequence.
 *
 * Fast intra-app navigations may not show the loader at all (Next
 * skips it when the new page resolves under ~100ms). That's the
 * intended UX — show the loader only when there's actually something
 * to wait for.
 */

import { VizzorLoader } from '@/components/layout/vizzor-loader';

export default function Loading() {
  return <VizzorLoader />;
}
