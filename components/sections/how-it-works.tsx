/**
 * HowItWorks — vertical, minimalist 3-step explanation.
 *
 * Ollama-style restraint: massive whitespace, centered headline + lede, a
 * single horizontal row of three numbered steps (no cards, no SVG diagrams,
 * no chrome). Each step is just typography — a big muted step number, a
 * short title, and a one-sentence description. The footer is a tiny muted
 * mono link to the ChronoVisor math docs.
 *
 * Server component — no event handlers, no state. Each step animates in
 * via `<MotionReveal>` with an 80ms stagger.
 */
import { getTranslations } from 'next-intl/server';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { MotionReveal } from '@/components/ui/motion-reveal';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { Link } from '@/i18n/navigation';

type StepKey = 'fetch' | 'fuse' | 'emit';

interface StepSpec {
  key: StepKey;
  number: string;
}

const STEPS: ReadonlyArray<StepSpec> = [
  { key: 'fetch', number: '01' },
  { key: 'fuse', number: '02' },
  { key: 'emit', number: '03' },
];

export async function HowItWorks() {
  const t = await getTranslations('howItWorks');

  return (
    <section
      aria-labelledby="how-it-works-title"
      className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 py-32 lg:py-40 text-center"
    >
      <GsapHeadline
        className="flex flex-col items-center gap-4 max-w-[60ch] mx-auto"
        eyebrow={<SectionEyebrow align="center">{t('eyebrow')}</SectionEyebrow>}
        title={t('title')}
        sub={t('lede')}
        titleId="how-it-works-title"
        titleClassName="text-3xl lg:text-5xl font-bold tracking-tight text-[var(--fg)]"
        subClassName="text-[var(--fg-2)] max-w-[58ch] mx-auto leading-relaxed"
      />

      <div className="mt-20 flex flex-col md:flex-row gap-12 md:gap-16 text-left max-w-[1000px] mx-auto">
        {STEPS.map((step, index) => (
          <MotionReveal key={step.key} delay={index * 80}>
            <div className="flex flex-col">
              <span
                className="mono tabular text-3xl font-bold leading-none text-[var(--fg-3)]"
                aria-hidden
              >
                {step.number}
              </span>
              <h3 className="text-xl font-semibold tracking-tight text-[var(--fg)] mt-3">
                {t(`steps.${step.key}.title`)}
              </h3>
              <p className="text-[15px] leading-relaxed text-[var(--fg-2)] mt-2">
                {t(`steps.${step.key}.description`)}
              </p>
            </div>
          </MotionReveal>
        ))}
      </div>

      <p className="mt-16 text-[12px] mono text-[var(--fg-3)]">
        <Link
          href="/docs/chronovisor"
          className="underline-offset-4 hover:text-[var(--fg)] hover:underline transition-colors"
        >
          {t('footer')}
        </Link>
      </p>
    </section>
  );
}
