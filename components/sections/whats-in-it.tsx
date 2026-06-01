/**
 * WhatsInIt — "What you actually GET when you ask Vizzor for a prediction."
 *
 * Ollama-style two-column layout: copy on the left (eyebrow → title → sub →
 * three checked bullets → see-the-math link), polished terminal mockup on
 * the right showing one complete prediction interaction with trigger snapshot.
 *
 * The terminal mockup uses the shared <TerminalBlock> atom for visual
 * consistency with the rest of the site. Two lines (direction+confidence,
 * entry) get a subtle accent highlight so the eye finds them first.
 *
 * Server component: translations only, no runtime data.
 */
import { getTranslations } from 'next-intl/server';
import { Check } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { MotionReveal } from '@/components/ui/motion-reveal';
import { TerminalBlock } from '@/components/ui/terminal-block';

const TERMINAL_CODE = `$ vizzor predict ETH 4h

ETH · 4h horizon · ✅ tracked
direction:  ↑ up  ·  confidence 0.78
entry:      $2,112.40
targets:    bull $2,174  ·  base $2,156  ·  bear $2,128

trigger snapshot
  ▸ onChain          +0.62  whale inflow $18.4M
  ▸ logicRules       +0.55  smart_money_accumulation
  ▸ mlEnsemble       +0.48  rsi 58.3 / ensemble 0.71
  ▸ patternMatch     +0.40  BOS 4h up
  ▸ predictionMarkets +0.31  implied 0.64
  ▸ socialNarrative  +0.18  sentiment 0.62

🔔 alerts armed at TP1 / TP2 / SL`;

export async function WhatsInIt() {
  const t = await getTranslations('whatsInIt');

  return (
    <section className="relative">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-32 lg:py-40">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* LEFT — copy column */}
          <div>
            <GsapHeadline
              eyebrow={
                <span className="mono tabular text-[12px] tracking-[0.18em] uppercase text-[var(--fg-3)]">
                  {t('eyebrow')}
                </span>
              }
              title={t('title')}
              sub={t('sub')}
              titleClassName="display text-[var(--fg)] text-balance text-[36px] sm:text-[44px] lg:text-[52px] leading-[1.08] tracking-tight font-semibold mt-4"
              subClassName="mt-6 text-[17px] leading-relaxed text-[var(--fg-2)] max-w-[44ch]"
            />

            <ul className="mt-10 space-y-4">
              <li className="flex items-start gap-3">
                <Check
                  size={20}
                  strokeWidth={2}
                  className="mt-[3px] flex-none text-[var(--accent)]"
                  aria-hidden
                />
                <span className="text-[16px] text-[var(--fg)] leading-relaxed">
                  {t('bullets.directional')}
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Check
                  size={20}
                  strokeWidth={2}
                  className="mt-[3px] flex-none text-[var(--accent)]"
                  aria-hidden
                />
                <span className="text-[16px] text-[var(--fg)] leading-relaxed">
                  {t('bullets.targets')}
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Check
                  size={20}
                  strokeWidth={2}
                  className="mt-[3px] flex-none text-[var(--accent)]"
                  aria-hidden
                />
                <span className="text-[16px] text-[var(--fg)] leading-relaxed">
                  {t('bullets.snapshot')}
                </span>
              </li>
            </ul>

            <div className="mt-10">
              <Link
                href="/docs/chronovisor"
                className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[var(--fg)] underline-offset-4 hover:underline"
              >
                <span>{t('learnMore')}</span>
                <span aria-hidden>→</span>
              </Link>
            </div>
          </div>

          {/* RIGHT — terminal mockup */}
          <MotionReveal delay={120}>
            <div className="relative">
              {/* Window chrome — three dots above the terminal block */}
              <div
                aria-hidden
                className="flex items-center gap-1.5 rounded-t-xl border border-b-0 border-[var(--border)] bg-[var(--code-bg)] px-4 py-3"
              >
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="mono ml-3 text-[10px] uppercase tracking-[0.18em] text-white/40">
                  vizzor · predict
                </span>
              </div>
              <div className="[&>div]:rounded-t-none [&>div]:border-t-0">
                <TerminalBlock
                  code={TERMINAL_CODE}
                  showPrompt={false}
                  highlightLines={[4, 5]}
                />
              </div>
            </div>
          </MotionReveal>
        </div>
      </div>
    </section>
  );
}
