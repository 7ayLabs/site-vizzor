/**
 * /manifesto — long-form editorial.
 *
 * Single-column, 58ch body width, 68ch headline. Five numbered sections each
 * wrapped in a MotionReveal for a staggered cascade as the reader scrolls.
 * Body paragraphs are kept in translation as one rich string per section;
 * we split on \n\n so the markup never carries copy.
 *
 * Voice: calm, anti-hype, signed by 7ayLabs. Body uses var(--fg) (not fg-2)
 * for high-readability long-form contrast.
 */

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { SectionEyebrow } from '@/components/ui/section-eyebrow';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { MotionReveal } from '@/components/ui/motion-reveal';

type SectionKey = 'section1' | 'section2' | 'section3' | 'section4' | 'section5';

interface ManifestoSection {
  key: SectionKey;
  number: string;
  delay: number;
}

const SECTIONS: ReadonlyArray<ManifestoSection> = [
  { key: 'section1', number: '§01', delay: 0 },
  { key: 'section2', number: '§02', delay: 60 },
  { key: 'section3', number: '§03', delay: 120 },
  { key: 'section4', number: '§04', delay: 180 },
  { key: 'section5', number: '§05', delay: 240 },
];

export default async function ManifestoPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('manifesto');

  return (
    <section className="relative">
      <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-16 lg:py-32">
        {/* Breadcrumb */}
        <div className="mb-10">
          <Link
            href="/"
            className="mono text-[12px] text-[var(--fg-3)] transition-colors duration-150 hover:text-[var(--fg)]"
          >
            ← Vizzor
          </Link>
        </div>

        {/* Hero — centered up to 68ch */}
        <div className="mx-auto max-w-[68ch]">
          <GsapHeadline
            as="h1"
            className="flex flex-col gap-5"
            eyebrow={<SectionEyebrow>{t('manifestoEyebrow')}</SectionEyebrow>}
            title={t('manifestoTitle')}
            sub={t('manifestoLede')}
            titleClassName="text-4xl sm:text-5xl lg:text-[clamp(2.5rem,4.5vw+1rem,4.5rem)] font-bold tracking-[-0.035em] leading-[1.05] text-[var(--fg)]"
            subClassName="mt-4 text-lg leading-[1.6] text-[var(--fg-2)]"
          />
        </div>

        {/* Body sections — 58ch column */}
        <div className="mx-auto mt-20 flex max-w-[58ch] flex-col gap-16">
          {SECTIONS.map((section) => {
            const body = t(`${section.key}.body`);
            const paragraphs = body.split(/\n\n+/).filter(Boolean);
            return (
              <MotionReveal key={section.key} delay={section.delay}>
                <article className="flex flex-col gap-5">
                  <SectionEyebrow>{section.number}</SectionEyebrow>
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight text-[var(--fg)]">
                    {t(`${section.key}.title`)}
                  </h2>
                  <div className="flex flex-col gap-4">
                    {paragraphs.map((para, idx) => (
                      <p
                        key={idx}
                        className="text-[16px] leading-[1.7] text-[var(--fg)]"
                      >
                        {para}
                      </p>
                    ))}
                  </div>
                </article>
              </MotionReveal>
            );
          })}
        </div>

        {/* Signature */}
        <MotionReveal delay={120}>
          <div className="mx-auto mt-20 max-w-[58ch]">
            <hr className="border-[var(--border)]" />
            <p className="mono mt-6 text-[12px] text-[var(--fg-3)]">
              {t('signature')}
            </p>
            <div className="mt-10">
              <Link
                href="/docs/chronovisor"
                className="text-[15px] font-medium text-[var(--fg)] underline-offset-4 hover:underline"
              >
                {t('seeReceipts')}
              </Link>
            </div>
          </div>
        </MotionReveal>
      </div>
    </section>
  );
}
