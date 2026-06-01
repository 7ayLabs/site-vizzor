/**
 * Hero — Ollama-style aggressive minimalism.
 *
 * One vertical axis, narrow column, massive whitespace. The hero reads top-to-
 * bottom: a geometric mark, the headline, the sub, one solid CTA, a CLI chip.
 *
 * Pure neutrals — black text on white / white text on near-black. The accent
 * color shows up exactly once (inside the geometric mark) and nowhere else,
 * matching the Ollama mascot/orange relationship.
 *
 * Server component: pure data read + render, no client state.
 */
import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import { CopyChip } from '@/components/ui/copy-chip';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { MotionReveal } from '@/components/ui/motion-reveal';

export async function Hero() {
  const t = await getTranslations('hero');

  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-[900px] px-4 sm:px-6 lg:px-8 py-32 lg:py-40 text-center">
        {/* 1. Brand mark — theme-swapped via the dark: variant (data-theme). */}
        <MotionReveal>
          <div className="mx-auto mb-12 flex h-24 items-center justify-center">
            <Image
              src="/brand/vizzor_darkicon.png"
              alt="Vizzor"
              width={364}
              height={535}
              priority
              className="block dark:hidden h-24 w-auto"
            />
            <Image
              src="/brand/vizzor_icon.png"
              alt="Vizzor"
              width={364}
              height={535}
              priority
              className="hidden dark:block h-24 w-auto"
            />
          </div>
        </MotionReveal>

        {/* 2. Headline */}
        <GsapHeadline
          as="h1"
          title={t('headline')}
          sub={t('sub')}
          titleClassName="display text-[var(--fg)] text-balance text-[44px] sm:text-[56px] lg:text-[64px] leading-[1.05] tracking-tight font-semibold"
          subClassName="mt-7 text-[17px] sm:text-lg leading-relaxed text-[var(--fg-2)] max-w-[40ch] mx-auto"
        />

        {/* 3. Primary CTA — Ollama-style solid pill, neutral colorway */}
        <MotionReveal delay={160}>
          <div className="mt-12 flex flex-col items-center gap-3">
            <a
              href="https://t.me/vizzorai_bot"
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

            {/* 4. Secondary line — quiet CLI install affordance */}
            <span className="mt-1 inline-flex items-center gap-2 text-[12px] text-[var(--fg-3)]">
              <span>{t('secondary')}</span>
              <CopyChip command="npm i -g @vizzor/cli" />
            </span>
          </div>
        </MotionReveal>
      </div>
    </section>
  );
}
