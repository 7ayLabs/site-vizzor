import type { ReactNode } from 'react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { TickerCarouselServer } from '@/components/layout/ticker-carousel-server';
import { PageTransition } from '@/components/layout/page-transition';

/**
 * Marketing layout — wraps every public page (home, pricing, manifesto,
 * changelog, account, wallet, cli-pair, telegram-pair, pay, legal, dev)
 * with the global Header + Footer + ticker tape.
 *
 * Lives in a `(marketing)` route group so it scopes the chrome WITHOUT
 * affecting URL paths. Sibling `app/` segment renders without this
 * chrome — that's the boundary between "marketing site" and "product".
 *
 * `PageTransition` stays here because each marketing route is a fresh
 * page; inside `/app/*` the shell is persistent and transitions would
 * read as jarring "reloads".
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
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
