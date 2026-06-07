'use client';

/**
 * Page transition wrapper.
 *
 * Re-keys on every pathname change so React unmounts the previous
 * page tree and remounts the new one, which triggers the CSS
 * `page-transition-enter` animation defined in app/globals.css and
 * mirrored into app/docs/docs.css.
 *
 * The effect is a calm 220ms fade + 6px slide-up — fast enough to
 * feel instant on intra-site nav, slow enough to register that the
 * page changed. Reduced-motion users get the final state with no
 * animation via the media block in the stylesheet.
 *
 * Why keying on `usePathname()` rather than React's built-in routing
 * tree: Next.js App Router keeps shared layouts mounted across
 * navigations (that's the point), so the leaf alone isn't enough to
 * trigger a remount. The pathname key is the explicit signal.
 */

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-transition-enter">
      {children}
    </div>
  );
}
