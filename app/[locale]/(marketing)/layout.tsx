import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { TickerCarouselServer } from '@/components/layout/ticker-carousel-server';
import { PageTransition } from '@/components/layout/page-transition';
import { AppHostTopbar } from '@/components/layout/app-host-topbar';

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
 * exhausted-tier upgrade CTA), we strip the marketing chrome and
 * substitute a minimal `AppHostTopbar`. The marketing nav
 * (Manifesto / Pricing / Changelog / Docs / Open App / Telegram) plus
 * the ticker tape and full footer all read as outbound noise on the
 * product host — the user already chose the app, surfacing those
 * pulls them back toward the marketing site.
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
      <>
        <AppHostTopbar />
        <main>
          <PageTransition>{children}</PageTransition>
        </main>
      </>
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
