/**
 * Hero — Ollama-shaped, demo-first.
 *
 * Vertical axis, narrow column. Top-to-bottom:
 *   1. Brand mark
 *   2. Big headline
 *   3. Sub
 *   4. Primary CTA — "Try Vizzor" → /predict (the on-site demo).
 *      This is the mass-market path; the navbar already pins the
 *      Telegram bot link so we deliberately don't repeat it here.
 *   5. Install command — the Ollama-style centerpiece for the
 *      power-user / self-host path. Click the card to copy.
 *   6. Helper line — one inline link to the CLI docs for context.
 *
 * Pure neutrals. The headline is the only block of large type on the
 * page; everything else is muted.
 */

import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { InstallCommand } from '@/components/ui/install-command';
import { MotionReveal } from '@/components/ui/motion-reveal';
import { Link } from '@/i18n/navigation';

const INSTALL_COMMAND = 'npm i -g @vizzor/cli';

export async function Hero() {
  const t = await getTranslations('hero');

  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-[760px] px-4 sm:px-6 lg:px-8 py-28 lg:py-36 text-center">
        {/* 1. Brand mark */}
        <MotionReveal>
          <div className="mx-auto mb-10 flex h-24 items-center justify-center">
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

        {/* 2. Headline + 3. Sub */}
        <GsapHeadline
          as="h1"
          title={t('headline')}
          sub={t('sub')}
          titleClassName="display text-[var(--fg)] text-balance text-[44px] sm:text-[60px] lg:text-[72px] leading-[1.02] tracking-tight font-semibold"
          subClassName="mt-6 text-[16px] sm:text-[17px] leading-relaxed text-[var(--fg-2)] max-w-[40ch] mx-auto"
        />

        {/* 4. Primary CTA + 5. install card.
            A tight `or` rule sits between them so the two paths (demo
            vs CLI) read as a deliberate split, not two stacked CTAs. */}
        <MotionReveal delay={140}>
          <div className="mt-10 mx-auto max-w-[420px] flex flex-col items-stretch gap-4">
            <Link
              href="/predict"
              className="
                group inline-flex items-center justify-center gap-2 h-12 px-6
                rounded-full bg-[var(--fg)] text-[var(--bg)]
                text-[14px] font-semibold tracking-tight
                transition-transform duration-150 ease-out
                hover:scale-[1.02] active:scale-[0.99]
              "
            >
              <span>{t('tryCta')}</span>
              <span
                aria-hidden
                className="transition-transform duration-150 ease-out group-hover:translate-x-0.5"
              >
                →
              </span>
            </Link>

            <div
              aria-hidden
              className="flex items-center gap-3 text-[var(--fg-3)]"
            >
              <span className="h-px flex-1 bg-[var(--border)]" />
              <span className="mono tabular text-[10.5px] uppercase tracking-[0.18em]">
                {t('orLabel')}
              </span>
              <span className="h-px flex-1 bg-[var(--border)]" />
            </div>

            <InstallCommand command={INSTALL_COMMAND} />
          </div>
        </MotionReveal>
      </div>
    </section>
  );
}
