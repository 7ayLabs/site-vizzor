/**
 * CtaBlock — Ollama "Get started" closing band.
 *
 * Centered, deliberately bare: no inset card, no border, no decorative
 * `vizzor>` marker. The eyebrow + title + lede land alone, followed by a
 * single solid full-pill primary button (fg/bg inversion — NOT the accent;
 * accent is reserved for the recommended-eyebrow moment) and a small mono
 * secondary line offering the CLI as an alternative.
 *
 * Server component: pure render, no data binding. Translation keys
 * (`eyebrow`, `title`, `body`) preserved from the previous version.
 */
import { getTranslations } from 'next-intl/server';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { CopyChip } from '@/components/ui/copy-chip';
import { MotionReveal } from '@/components/ui/motion-reveal';
import { GsapHeadline } from '@/components/ui/gsap-headline';

export async function CtaBlock() {
  const t = await getTranslations('ctaBlock');

  return (
    <section
      aria-labelledby="cta-block-title"
      className="mx-auto max-w-[800px] px-4 sm:px-6 lg:px-8 py-32 lg:py-44 text-center"
    >
      <MotionReveal>
        <div className="flex flex-col items-center gap-6">
          <GsapHeadline
            className="flex flex-col items-center gap-5 w-full"
            eyebrow={<SectionEyebrow align="center">{t('eyebrow')}</SectionEyebrow>}
            title={t('title')}
            sub={t('body')}
            titleId="cta-block-title"
            titleClassName="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-center max-w-[20ch] mx-auto text-[var(--fg)]"
            subClassName="text-center text-[var(--fg-2)] max-w-[52ch] mx-auto leading-relaxed"
          />

          <div className="mt-10 flex flex-col items-center gap-4">
            <a
              href="https://t.me/VizzorBot"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center justify-center whitespace-nowrap rounded-full bg-[var(--fg)] text-[var(--bg)] h-12 px-8 text-[15px] font-semibold tracking-tight transition-transform duration-150 ease-out hover:scale-[1.02] active:scale-[0.99]"
            >
              {t('ctaTelegram')}
            </a>
            <CopyChip command="npm i -g @vizzor/cli" />
          </div>
        </div>
      </MotionReveal>
    </section>
  );
}
