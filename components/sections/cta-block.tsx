/**
 * CtaBlock — closing prompt with a particle-converge backdrop.
 *
 * Web-first conversion: the section's job is to land the visitor on the
 * web app, not in Telegram or in the CLI install flow. Both of those
 * channels remain present in the global chrome (header Telegram icon +
 * CLI link, footer "Surfaces" column) so they stay one click away
 * without splitting the page's primary CTA.
 *
 * Composition:
 *   - `<ParticleConverge>` lazy-loaded behind everything at ~50% opacity
 *   - Eyebrow + headline + sub (web-app framing)
 *   - SINGLE primary `<CtaPrimary>` → `getAppLinkTarget()` (prod = new
 *     tab to app.vizzor.ai; dev = locale-aware Link to /app/predict)
 *
 * The `$ vizzor connect` terminal prompt was intentionally dropped: it
 * suggested a CLI conversion that the new copy no longer leads with.
 * The remaining backdrop is the ParticleConverge field, which keeps the
 * section visually anchored without competing with the single CTA.
 *
 * Server component shell; the WebGL particle field is isolated in
 * `cta-block.client`. Translation namespace: `ctaBlock`.
 */
import { getTranslations } from 'next-intl/server';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { CtaPrimary } from '@/components/ui/cta-primary';
import { ScanlineOverlay } from '@/components/ui/scanline-overlay';
import { getAppLinkTarget } from '@/lib/app-url';
import { CtaParticleBackground } from './cta-block.client';

export async function CtaBlock() {
  const t = await getTranslations('ctaBlock');
  const appLink = getAppLinkTarget();

  return (
    <section
      aria-labelledby="cta-block-title"
      className="relative isolate overflow-hidden"
    >
      <CtaParticleBackground height={360} />
      <ScanlineOverlay opacity={0.4} />

      <div className="relative z-10 mx-auto flex min-h-[80vh] max-w-[860px] flex-col items-center justify-center px-4 sm:px-6 lg:px-8 py-32 lg:py-44 text-center">
        <GsapHeadline
          glitch
          className="flex flex-col items-center gap-5 w-full"
          eyebrow={<SectionEyebrow align="center">{t('eyebrow')}</SectionEyebrow>}
          title={t('title')}
          sub={t('body')}
          titleId="cta-block-title"
          titleClassName="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-center max-w-[20ch] mx-auto text-[var(--fg)]"
          subClassName="text-center text-[var(--fg-2)] max-w-[56ch] mx-auto leading-relaxed"
        />

        {/* Single primary CTA — web app. Telegram + CLI are reachable
            from the header and footer; this section converts one thing. */}
        <div className="mt-10">
          <CtaPrimary
            magnetic
            href={appLink.href}
            external={appLink.external}
            size="lg"
          >
            {t('ctaWeb')}
          </CtaPrimary>
        </div>
      </div>
    </section>
  );
}
