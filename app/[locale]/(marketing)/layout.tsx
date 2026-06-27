import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { Toaster } from 'sonner';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { TickerCarouselServer } from '@/components/layout/ticker-carousel-server';
import { PageTransition } from '@/components/layout/page-transition';
import { AppHostTopbar } from '@/components/layout/app-host-topbar';
import { ProductSidebar } from '@/components/app/product-sidebar';

/**
 * Marketing layout — wraps every public page (home, pricing, manifesto,
 * blog, account, wallet, cli-pair, telegram-pair, pay, legal, dev)
 * with the global Header + Footer + ticker tape.
 *
 * Lives in a `(marketing)` route group so it scopes the chrome WITHOUT
 * affecting URL paths. Sibling `app/` segment renders without this
 * chrome — that's the boundary between "marketing site" and "product".
 *
 * Host swap: when the visitor reaches a marketing route through the
 * product subdomain (e.g. `app.vizzor.ai/account` after clicking the
 * profile dropdown, or `app.vizzor.ai/pricing` from the
 * exhausted-tier upgrade CTA) we mount the same predict-shell-style
 * left rail (`ProductSidebar`) the chat surface uses, so every page
 * on the product host shares one vocabulary: New run / Run / Alerts
 * / Receipts / Recent chats / wallet Identity. The marketing chrome
 * (ticker tape, capsule navbar, footer) reads as outbound noise on
 * the product host — the user already chose the app, surfacing
 * those pulls them back toward the marketing site.
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
        {/* ProductSidebar mirrors the predict-shell left rail (New
            run / Run / Alerts / Receipts / Recent chats / wallet
            Identity) so every page on the product host shares the
            same chrome predict uses — not the umbrella AppSidebar
            with its Surfaces/Whales/Flow vocabulary. It does NOT
            need the AppShellProvider because the Identity pill reads
            session state via its own SWR (no wallet-adapter context
            required for read-only display). Keeping it out of the
            provider also preserves SSR for the marketing children. */}
        <ProductSidebar />
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
