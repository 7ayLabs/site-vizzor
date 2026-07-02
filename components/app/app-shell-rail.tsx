'use client';

/**
 * AppShellRail — picks the right left rail per `/app/*` route.
 *
 * Four cases:
 *
 *   1. `/app/predict(/...)` — predict-shell already renders its own
 *      `LeftRail` inline. Return `null` to avoid a double rail.
 *   2. `/app/account(/...)` — uses the same predict-shell-style chrome
 *      (`ProductSidebar`) so the user's mental model stays consistent:
 *      "the product looks like predict" across surfaces. Mounted on
 *      every host (mainnet vizzor.ai and product app.vizzor.ai) — this
 *      is the chrome Zaid signed off on for the account view before
 *      the route moved from `(marketing)/account` to `/app/account`.
 *   3. `/app/directory(/...)` — same `ProductSidebar` chrome as the
 *      account surface. The Directory is a product extension surface
 *      ("here's what your account can do"), so it shares the predict-
 *      style rail rather than the umbrella switcher.
 *   4. `/app/workflows(/...)` — same predict-style chrome. Workflows
 *      is where the user tracks capability intents they minted from
 *      the predict composer, so the sidebar reads as an extension of
 *      predict (same Nueva predicción / Predecir / Alertas / Directorio
 *      / Flujos affordances) instead of jumping into the umbrella.
 *   5. Everything else (`/app/whales`, `/app/flow`, `/app/billing`,
 *      `/app/settings`, `/app/alerts`) — the umbrella `AppSidebar`
 *      with the Chat/Whales/Flow surface switcher, gated on
 *      `isAppOnlyHost` so the app subdomain doesn't double up on
 *      chrome (the marketing-route swap takes over there).
 *
 * Client component because the picker uses `usePathname()`. The parent
 * `AppLayout` stays an async server component (it reads the Host header
 * server-side); this picker is the only client island it mounts.
 */

import { usePathname } from 'next/navigation';
import { AppSidebar } from './app-sidebar';
import { ProductSidebar } from './product-sidebar';

interface AppShellRailProps {
  isAppOnlyHost: boolean;
}

const PREDICT_RE = /^\/(?:[a-z]{2}\/)?app\/predict(\/|$)/;
const PRODUCT_RAIL_RE = /^\/(?:[a-z]{2}\/)?app\/(?:account|directory|workflows)(\/|$)/;

export function AppShellRail({ isAppOnlyHost }: AppShellRailProps) {
  const pathname = usePathname();
  if (PREDICT_RE.test(pathname)) return null;
  if (PRODUCT_RAIL_RE.test(pathname)) return <ProductSidebar />;
  return isAppOnlyHost ? null : <AppSidebar />;
}
