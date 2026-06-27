/**
 * AppHostTopbar — minimal back-to-predict topbar for marketing routes
 * served on `app.vizzor.ai`.
 *
 * When the user lands on a marketing route (e.g. /account, /pricing,
 * /pay/...) via the product subdomain we strip the full marketing
 * chrome (Header, TickerCarousel, Footer) because those carry a
 * different visual contract — outbound nav (Manifesto / Pricing /
 * Blog / Docs), the price ticker tape, the Open App CTA — that
 * has no business inside the product host.
 *
 * What stays: a single hairline bar with the Vizzor mark on the left
 * and one anchor link back to /app/predict on the right. The mark
 * doubles as a home link to the same destination so the user has two
 * predictable escape hatches without any chrome competing with the
 * page content below.
 *
 * Color discipline: tokens only (--fg, --fg-2, --fg-3, --surface,
 * --border). Mirrors the AppSidebar header for visual continuity with
 * the predict surface they came from.
 */

import { Link } from '@/i18n/navigation';
import Image from 'next/image';
import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

export async function AppHostTopbar() {
  const t = await getTranslations('app.hostTopbar');

  return (
    <header
      className="
        sticky top-0 z-40
        flex items-center justify-between gap-3
        h-12 px-4 sm:px-6
        border-b border-[var(--border)]
        bg-[color-mix(in_oklab,var(--surface)_92%,transparent)]
        backdrop-blur-md
      "
    >
      <Link
        href="/app/predict"
        aria-label={t('home')}
        className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-[var(--fg)] hover:opacity-80 transition-opacity"
      >
        <Image
          src="/brand/vizzor_darkicon.png"
          alt=""
          width={364}
          height={535}
          priority
          className="block dark:hidden h-5 w-auto"
        />
        <Image
          src="/brand/vizzor_icon.png"
          alt=""
          width={364}
          height={535}
          priority
          className="hidden dark:block h-5 w-auto"
        />
        <span>vizzor</span>
      </Link>

      <Link
        href="/app/predict"
        className="
          inline-flex items-center gap-1.5 h-8 px-3 rounded-full
          border border-[var(--border)]
          text-[12px] font-medium text-[var(--fg-2)]
          hover:text-[var(--fg)] hover:bg-[var(--surface-2)]
          transition-colors
        "
      >
        <ArrowLeft size={12} strokeWidth={2} aria-hidden />
        <span>{t('backToPredict')}</span>
      </Link>
    </header>
  );
}
