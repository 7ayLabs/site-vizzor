'use client';

/**
 * ChromeGate — hides global marketing chrome on chat-style routes.
 *
 * On /predict we hide:
 *   - the marketing Footer (long content below would push the chat
 *     past the viewport and clip the sidebar's docked Identity row),
 *   - the global Header (the chat shell renders its own brand cap +
 *     navigation inside the sidebar, so a second navbar is just
 *     duplicated chrome).
 *
 * The Ticker stays because it's part of the product surface, not the
 * marketing site.
 */

import { usePathname } from '@/i18n/navigation';

const CHROMELESS_ROUTES: readonly string[] = ['/predict'];

export function ChromeGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isChromeless = CHROMELESS_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  if (isChromeless) return null;
  return <>{children}</>;
}
