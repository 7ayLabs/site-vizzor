/**
 * Hero — asymmetric terminal-dashboard composition.
 *
 * Replaces the previous centered/vertical Ollama-shaped hero. The new
 * layout follows the reference dashboard pattern (headline + CTAs left,
 * floating data cards right) but renders through Vizzor's strict
 * monochrome aesthetic — corner brackets, scanlines, hairline borders,
 * mono typography. The cards display real live data via the same SWR
 * hooks the rest of the site uses, so the hero is genuine product
 * evidence, not decorative imagery.
 *
 * Composition (desktop ≥lg):
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ EYEBROW (live ribbon)        ┌────────────────────────┐    │
 *   │                              │  TRACKER WR (ring)     │    │
 *   │ HUGE DISPLAY HEADLINE        │                        │    │
 *   │ Predict. Resolve. Score.     └────────────────────────┘    │
 *   │                                                             │
 *   │ Sub copy (2 lines)           ┌──────────────────────┐      │
 *   │                              │  LIVE MARKET FEED    │      │
 *   │ [Open App ↗]  [Manifesto]    │  BTC ETH SOL ...     │      │
 *   │                              └──────────────────────┘      │
 *   │ Mono stat strip · chains ·                                  │
 *   │ signal families · cli         ┌──────────────────────────┐  │
 *   │                               │  RECEIPTS (last N)       │  │
 *   │                               └──────────────────────────┘  │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Mobile: cards stack BELOW the headline column, condensed.
 *
 * Server shell + client `HeroDataCards` (live SWR). The shell stays a
 * server component so static SSG of the locale page keeps working.
 */

import { getTranslations } from 'next-intl/server';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { MotionReveal } from '@/components/ui/motion-reveal';
import { Link } from '@/i18n/navigation';
import { getAppLinkTarget } from '@/lib/app-url';
import { HeroDataCards } from './hero-data-cards';

export async function Hero() {
  const t = await getTranslations('hero');
  const appLink = getAppLinkTarget();
  const primaryCtaClasses = `
    group inline-flex items-center justify-center gap-2 h-12 px-6
    rounded-full bg-[var(--fg)] text-[var(--bg)]
    text-[14px] font-semibold tracking-tight
    transition-transform duration-150 ease-out
    hover:scale-[1.02] active:scale-[0.99]
    focus-visible:outline-none focus-visible:ring-2
    focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2
    focus-visible:ring-offset-[var(--bg)]
  `;
  // Arrow glyph differs by destination — `↗` reinforces "leaves this
  // site" when external; `→` reads as same-site navigation in dev.
  const primaryCtaContent = (
    <>
      <span>{t('primaryCta')}</span>
      <span
        aria-hidden
        className="transition-transform duration-150 ease-out group-hover:translate-x-0.5"
      >
        {appLink.external ? '↗' : '→'}
      </span>
    </>
  );

  return (
    <section className="relative overflow-hidden">
      {/* Atmospheric backdrop — subtle radial luminance behind the
          headline column so the page doesn't feel like a flat slab.
          Monochrome (no chromatic accent). */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-60"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 50% 40% at 18% 30%,
              color-mix(in oklab, var(--fg) 6%, transparent) 0%,
              transparent 60%)
          `,
        }}
      />

      <div className="relative mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 pt-14 pb-20 lg:pt-20 lg:pb-32">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          {/* ── LEFT: headline + CTAs ─────────────────────────────── */}
          <div className="lg:col-span-7 flex flex-col">
            {/* Headline + sub. The display-class typography is the
                only block of large type on the page; the rest of the
                hero (and the page below it) stays muted by comparison. */}
            <GsapHeadline
              as="h1"
              title={t('headline')}
              sub={t('sub')}
              titleClassName="display text-[var(--fg)] text-balance text-[44px] sm:text-[60px] lg:text-[80px] leading-[0.98] tracking-[-0.035em] font-semibold"
              subClassName="mt-6 text-[16px] sm:text-[17px] leading-relaxed text-[var(--fg-2)] max-w-[52ch]"
            />

            {/* CTA cluster — primary into the product, secondary into
                the brand essay. Open-App is filled (the product is the
                conversion target); Manifesto is outline-only. URL +
                target resolved by `getAppLinkTarget()` — external in
                prod (new tab), internal locale-aware Link in dev. */}
            <MotionReveal delay={140}>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                {appLink.external ? (
                  <a
                    href={appLink.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${t('primaryCta')} (opens in a new tab)`}
                    className={primaryCtaClasses}
                  >
                    {primaryCtaContent}
                  </a>
                ) : (
                  <Link
                    href={appLink.href as '/app/predict'}
                    className={primaryCtaClasses}
                  >
                    {primaryCtaContent}
                  </Link>
                )}
                <Link
                  href="/manifesto"
                  className="
                    inline-flex items-center justify-center h-12 px-5
                    rounded-full border border-[var(--border)] bg-transparent
                    text-[13.5px] font-medium text-[var(--fg-2)]
                    hover:text-[var(--fg)] hover:bg-[var(--surface-2)] hover:border-[var(--border-hi)]
                    transition-colors
                  "
                >
                  {t('secondaryCta')}
                </Link>
              </div>
            </MotionReveal>
          </div>

          {/* ── RIGHT: floating data cards ─────────────────────────── */}
          <div className="lg:col-span-5 relative">
            <HeroDataCards />
          </div>
        </div>
      </div>
    </section>
  );
}

