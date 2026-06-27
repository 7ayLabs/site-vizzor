/**
 * HowItWorks — "How easy is it to set up?" three-card section, modelled
 * on the Heylink reference (eyebrow chip → big H2 → three side-by-side
 * cards each containing a mock product UI + step label + title + one-
 * line description), reinterpreted through Vizzor's strict monochrome
 * brand language (mono type, hairline borders, --fg/--bg/--surface-2
 * tokens — no pastel chromatic accents).
 *
 * The section is a server-component shell: copy lives here, the
 * interactive card grid + GSAP reveal lives in `how-it-works.client`
 * so the client bundle stays small.
 *
 * Three steps, Vizzor-native mocks:
 *   01 Sign in    — SIWS button + wallet identicon
 *   02 Predict    — chat composer with placeholder prompt + confidence chip
 *   03 Resolve    — Telegram-style "prediction resolved" notification
 *
 * Closing CTA cluster: primary "Open App" + secondary "See pricing".
 *
 * Translation namespace: `howItWorks`.
 */
import { getTranslations } from 'next-intl/server';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { Link } from '@/i18n/navigation';
import { getAppLinkTarget } from '@/lib/app-url';
import { HowItWorksClient, type HowItWorksStep } from './how-it-works.client';

type StepKey = 'connect' | 'predict' | 'resolve';

interface StepSpec {
  key: StepKey;
  number: string;
}

const STEPS: readonly [StepSpec, StepSpec, StepSpec] = [
  { key: 'connect', number: '01' },
  { key: 'predict', number: '02' },
  { key: 'resolve', number: '03' },
];

export async function HowItWorks() {
  const t = await getTranslations('howItWorks');
  const appLink = getAppLinkTarget();

  const steps = STEPS.map<HowItWorksStep>((s) => ({
    key: s.key,
    number: s.number,
    eyebrow: t(`steps.${s.key}.eyebrow`),
    title: t(`steps.${s.key}.title`),
    description: t(`steps.${s.key}.description`),
  })) as unknown as readonly [HowItWorksStep, HowItWorksStep, HowItWorksStep];

  const primaryCtaClass = `
    group inline-flex items-center justify-center gap-2 h-12 px-6
    rounded-full bg-[var(--fg)] text-[var(--bg)]
    text-[14px] font-semibold tracking-tight
    transition-transform duration-150 ease-out
    hover:scale-[1.02] active:scale-[0.99]
    focus-visible:outline-none focus-visible:ring-2
    focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2
    focus-visible:ring-offset-[var(--bg)]
  `;

  const secondaryCtaClass = `
    inline-flex items-center justify-center h-12 px-5
    rounded-full border border-[var(--border)] bg-transparent
    text-[13.5px] font-medium text-[var(--fg-2)]
    hover:text-[var(--fg)] hover:bg-[var(--surface-2)] hover:border-[var(--border-hi)]
    transition-colors
    focus-visible:outline-none focus-visible:ring-2
    focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2
    focus-visible:ring-offset-[var(--bg)]
  `;

  return (
    <section
      aria-labelledby="how-it-works-title"
      className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-20 md:py-28 lg:py-32"
    >
      <GsapHeadline
        className="flex flex-col items-center gap-4 max-w-[60ch] mx-auto text-center"
        eyebrow={<SectionEyebrow align="center">{t('eyebrow')}</SectionEyebrow>}
        title={t('title')}
        sub={t('lede')}
        titleId="how-it-works-title"
        titleClassName="display text-[var(--fg)] text-balance text-[clamp(28px,5vw,52px)] tracking-tight leading-[1.05] font-semibold"
        subClassName="text-[var(--fg-2)] max-w-[58ch] mx-auto leading-relaxed text-[15px] sm:text-[16px]"
      />

      <HowItWorksClient steps={steps} />

      <div className="mt-14 flex flex-col items-center gap-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {appLink.external ? (
            <a
              href={appLink.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${t('primaryCta')} (opens in a new tab)`}
              className={primaryCtaClass}
            >
              <span>{t('primaryCta')}</span>
              <span
                aria-hidden
                className="transition-transform duration-150 ease-out group-hover:translate-x-0.5"
              >
                ↗
              </span>
            </a>
          ) : (
            <Link
              href={appLink.href as '/app/predict'}
              className={primaryCtaClass}
            >
              <span>{t('primaryCta')}</span>
              <span
                aria-hidden
                className="transition-transform duration-150 ease-out group-hover:translate-x-0.5"
              >
                →
              </span>
            </Link>
          )}
          <Link href="/pricing" className={secondaryCtaClass}>
            {t('secondaryCta')}
          </Link>
        </div>
        <p className="text-[12px] mono text-[var(--fg-3)]">
          <Link
            href="/docs/chronovisor"
            className="underline-offset-4 hover:text-[var(--fg)] hover:underline transition-colors"
          >
            {t('footer')}
          </Link>
        </p>
      </div>
    </section>
  );
}
