/**
 * CtaBlock — closing terminal prompt with a particle-converge backdrop.
 *
 * Layout:
 *   - Tall, vertically-centered section
 *   - `<ParticleConverge>` lazy-loaded behind everything at ~50% opacity
 *   - Centerpiece: terminal prompt `$ vizzor connect _` with a CSS-only
 *     blinking cursor (suppressed under prefers-reduced-motion)
 *   - Two CTAs: magnetic `<CtaPrimary>` (Open in Telegram) +
 *     `<CtaSecondary>` (Try free / install CLI)
 *
 * Server component shell; the WebGL particle field is isolated in
 * `cta-block.client`. Reuses every translation key from the existing
 * `ctaBlock` namespace (eyebrow, title, body, ctaTelegram, ctaCli).
 */
import { getTranslations } from 'next-intl/server';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { CtaPrimary } from '@/components/ui/cta-primary';
import { CtaSecondary } from '@/components/ui/cta-secondary';
import { ScanlineOverlay } from '@/components/ui/scanline-overlay';
import { CtaParticleBackground } from './cta-block.client';

export async function CtaBlock() {
  const t = await getTranslations('ctaBlock');

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
          subClassName="text-center text-[var(--fg-2)] max-w-[52ch] mx-auto leading-relaxed"
        />

        {/* Terminal prompt — pure markup. Blink keyframe is gated by
            prefers-reduced-motion via the inline <style> below. */}
        <div
          className="mt-10 inline-flex items-center gap-2 rounded-md border border-[var(--border-hi)] bg-[var(--code-bg)] px-5 py-3 vt-bracket"
          role="img"
          aria-label="$ vizzor connect"
        >
          <span
            aria-hidden
            className="mono tabular text-[14px] text-[var(--accent)]"
          >
            $
          </span>
          <span
            aria-hidden
            className="mono tabular text-[14px] text-[var(--code-fg)]"
          >
            vizzor connect
          </span>
          <span
            aria-hidden
            className="cta-cursor inline-block h-[14px] w-[8px] translate-y-[2px] bg-[var(--accent)]"
          />
        </div>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <CtaPrimary
            magnetic
            href="https://t.me/vizzorai_bot"
            external
            size="lg"
          >
            {t('ctaTelegram')}
          </CtaPrimary>
          <CtaSecondary href="/docs/cli" size="lg">
            {t('ctaCli')}
          </CtaSecondary>
        </div>
      </div>

      <style>{`
        @keyframes cta-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        .cta-cursor {
          animation: cta-blink 1s steps(1, end) infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .cta-cursor { animation: none; opacity: 1; }
        }
      `}</style>
    </section>
  );
}
