/**
 * Hero — Ollama-style aggressive minimalism.
 *
 * One vertical axis, narrow column, massive whitespace. The hero reads top-to-
 * bottom: a quiet ribbon line, a geometric mark, the headline, the sub, one
 * solid CTA, a CLI chip below, and three quiet credibility badges.
 *
 * Pure neutrals — black text on white / white text on near-black. The accent
 * color shows up exactly once (inside the geometric mark) and nowhere else,
 * matching the Ollama mascot/orange relationship.
 *
 * Server component: pure data read + render, no client state.
 */
import { getTranslations } from 'next-intl/server';
import { CopyChip } from '@/components/ui/copy-chip';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { MotionReveal } from '@/components/ui/motion-reveal';
import { getCalibrationBanner } from '@/lib/snapshot';

export async function Hero() {
  const t = await getTranslations('hero');
  const calibration = getCalibrationBanner();
  const targetPct = Math.round(calibration.target * 100);
  const ribbonCopy = t('ribbon', {
    version: calibration.version,
    target: targetPct,
  });

  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-[900px] px-4 sm:px-6 lg:px-8 py-32 lg:py-40 text-center">
        {/* 1. Ribbon line */}
        <MotionReveal>
          <p className="mono tabular text-[12px] tracking-[0.18em] uppercase text-[var(--fg-3)]">
            {ribbonCopy}
          </p>
        </MotionReveal>

        {/* 2. Geometric mark — concentric squares with a single emerald core. */}
        <MotionReveal delay={80}>
          <div
            aria-hidden
            className="mx-auto mt-12 mb-12 flex h-24 w-24 items-center justify-center"
          >
            <svg
              viewBox="0 0 96 96"
              width="96"
              height="96"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="square"
              strokeLinejoin="miter"
              className="text-[var(--fg)]"
            >
              {/* Outer square */}
              <rect x="4" y="4" width="88" height="88" />
              {/* Mid square — rotated 45° gives the lens / chronovisor feel */}
              <rect
                x="18"
                y="18"
                width="60"
                height="60"
                transform="rotate(45 48 48)"
              />
              {/* Inner square */}
              <rect x="30" y="30" width="36" height="36" />
              {/* Accent core — filled emerald */}
              <rect
                x="42"
                y="42"
                width="12"
                height="12"
                fill="var(--accent)"
                stroke="none"
              />
            </svg>
          </div>
        </MotionReveal>

        {/* 3. Headline */}
        <GsapHeadline
          as="h1"
          title={t('headline')}
          sub={t('sub')}
          titleClassName="display text-[var(--fg)] text-balance text-[44px] sm:text-[56px] lg:text-[64px] leading-[1.05] tracking-tight font-semibold"
          subClassName="mt-7 text-[17px] sm:text-lg leading-relaxed text-[var(--fg-2)] max-w-[40ch] mx-auto"
        />

        {/* 5. Primary CTA — Ollama-style solid pill, neutral colorway */}
        <MotionReveal delay={160}>
          <div className="mt-12 flex flex-col items-center gap-3">
            <a
              href="https://t.me/VizzorBot"
              target="_blank"
              rel="noopener"
              className="inline-flex h-13 items-center justify-center rounded-full bg-[var(--fg)] px-7 text-[15px] font-semibold tracking-tight text-[var(--bg)] transition-transform duration-150 ease-out hover:scale-[1.02] active:scale-[0.99]"
              style={{ height: '3.25rem' }}
            >
              <span>{t('primaryCta')}</span>
              <span aria-hidden className="ml-2">
                →
              </span>
            </a>

            {/* 6. Secondary line — quiet CLI install affordance */}
            <span className="mt-1 inline-flex items-center gap-2 text-[12px] text-[var(--fg-3)]">
              <span>{t('secondary')}</span>
              <CopyChip command="npm i -g @vizzor/cli" />
            </span>
          </div>
        </MotionReveal>

        {/* 7. Quiet credibility badges */}
        <MotionReveal delay={240}>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12px] text-[var(--fg-3)]">
            <span className="mono tabular">{t('badges.chains')}</span>
            <span aria-hidden className="text-[var(--fg-3)]/40">
              ·
            </span>
            <span className="mono tabular">{t('badges.signals')}</span>
            <span aria-hidden className="text-[var(--fg-3)]/40">
              ·
            </span>
            <span className="mono tabular">{t('badges.license')}</span>
          </div>
        </MotionReveal>
      </div>
    </section>
  );
}
