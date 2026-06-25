import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { Toaster } from 'sonner';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { TickerCarouselServer } from '@/components/layout/ticker-carousel-server';
import { PageTransition } from '@/components/layout/page-transition';
import { AppHostTopbar } from '@/components/layout/app-host-topbar';
import { AppShellProvider } from '@/components/app/app-shell-provider';
import { AppSidebar } from '@/components/app/app-sidebar';

/**
 * Marketing layout — wraps every public page (home, pricing, manifesto,
 * changelog, account, wallet, cli-pair, telegram-pair, pay, legal, dev)
 * with the global Header + Footer + ticker tape.
 *
 * Lives in a `(marketing)` route group so it scopes the chrome WITHOUT
 * affecting URL paths. Sibling `app/` segment renders without this
 * chrome — that's the boundary between "marketing site" and "product".
 *
 * Host swap: when the visitor reaches a marketing route through the
 * product subdomain (e.g. `app.vizzor.ai/account` after clicking the
 * profile dropdown, or `app.vizzor.ai/pricing` from the
 * exhausted-tier upgrade CTA) we mount the full app shell — the same
 * `AppShellProvider` + `AppSidebar` that wraps `/app/*` surfaces. The
 * marketing chrome (ticker tape, capsule navbar, footer) reads as
 * outbound noise on the product host — the user already chose the
 * app, surfacing those pulls them back toward the marketing site.
 * Mounting the real sidebar instead means every page on
 * `app.vizzor.ai` shares the same surface switcher, footer items,
 * status pill, and wallet pill the predict surface uses.
 *
 * Mobile (< lg) falls back to a minimal `AppHostTopbar` since the
 * sidebar is desktop-only — the topbar carries the brand + a
 * back-to-predict anchor so the user always has a way home.
 *
 * `PageTransition` stays in both branches because each marketing
 * route is a fresh page transition either way.
 */
const APP_ONLY_HOSTS = new Set<string>(['app.vizzor.ai']);

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const reqHeaders = await headers();
  const host = (reqHeaders.get('host') ?? '').split(':')[0]?.toLowerCase() ?? '';
  const isAppHost = APP_ONLY_HOSTS.has(host);

  if (isAppHost) {
    return (
      <div className="flex min-h-dvh bg-[var(--bg)]">
        {/* AppShellProvider lazy-loads the Solana wallet adapter with
            `ssr: false`, so we keep its scope tight to just the
            sidebar. Wrapping the full layout in it would skip SSR for
            the marketing children (broken first paint on /pricing,
            blank /account before hydration). The marketing children
            don't read `useAppShell()` themselves; only the sidebar's
            WalletAuthButton needs the wallet context. */}
        <AppShellProvider>
          <AppSidebar />
        </AppShellProvider>
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Mobile-only topbar — AppSidebar is `hidden lg:flex`, so
              viewports under `lg` would otherwise lose every escape
              hatch back to /app/predict. The topbar carries the brand
              and a back link; desktop hides it because the sidebar
              already provides both. */}
          <div className="lg:hidden">
            <AppHostTopbar />
          </div>
          <main className="flex-1 min-w-0">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          toastOptions={{ className: 'sonner-toast' }}
        />
      </div>
    );
  }

  return (
    <>
      <TickerCarouselServer />
      <Header />
      <main>
        <PageTransition>{children}</PageTransition>
      </main>
      <Footer />
    </>
  );
}
