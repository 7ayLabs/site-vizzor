/**
 * /pricing — Ollama-style tier composition adapted to Vizzor.
 *
 * Layout, top to bottom:
 *   1. Big centered "Pricing" h1 + sub
 *   2. Three tier cards in a row (Free · Pro · Elite) — Pro is the
 *      featured/recommended tier (accent border + "Most popular" pill).
 *   3. 7-day trial callout — every new user gets Pro on first /start.
 *   4. Accepted-payments block — TON Connect (Phase 1) + EVM/Solana/TRON
 *      stablecoins (Phase 2).
 *   5. FAQ — six common questions.
 *   6. Self-host CTA — Vizzor is BUSL-licensed, run it yourself if you
 *      prefer not to pay a subscription.
 *
 * Server component. All copy lives in `messages/*.json`.
 */

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Check } from 'lucide-react';
import { CtaPrimary } from '@/components/ui/cta-primary';
import { CtaSecondary } from '@/components/ui/cta-secondary';
import { CopyChip } from '@/components/ui/copy-chip';
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { MotionReveal } from '@/components/ui/motion-reveal';

type Cadence = 'monthly' | 'annual' | 'lifetime';

interface Tier {
  key: 'free' | 'pro' | 'elite';
  highlighted?: boolean;
  ctaHref: string;
  ctaVariant: 'primary' | 'outline';
  /** Alternative billing cycles, rendered as secondary links under the
   *  primary CTA. Empty for Free. */
  altCadences: ReadonlyArray<Cadence>;
}

const BOT = 'https://t.me/vizzorai_bot';

const TIERS: ReadonlyArray<Tier> = [
  {
    key: 'free',
    ctaHref: BOT,
    ctaVariant: 'outline',
    altCadences: [],
  },
  {
    key: 'pro',
    highlighted: true,
    ctaHref: `${BOT}?start=pay_pro_monthly`,
    ctaVariant: 'primary',
    altCadences: ['annual'],
  },
  {
    key: 'elite',
    ctaHref: `${BOT}?start=pay_elite_monthly`,
    ctaVariant: 'primary',
    altCadences: ['annual', 'lifetime'],
  },
];

/**
 * Deep-link payloads for each cadence. The bot routes
 * `?start=pay_<tier>_<cadence>` to the matching payment flow
 * (TON Connect for Phase 1, EVM/SOL/TRON watchers for Phase 2).
 */
function cadenceHref(tier: Tier['key'], cadence: Cadence): string {
  return `${BOT}?start=pay_${tier}_${cadence}`;
}

const FEATURE_KEYS: Record<Tier['key'], readonly string[]> = {
  free: ['predictions', 'tiers', 'commands', 'cliApi', 'community'],
  pro: ['predictions', 'allTiers', 'precisions', 'alerts', 'polymarketAlerts', 'priority'],
  elite: [
    'agents',
    'agentWallets',
    'polymarketAgent',
    'circuitBreaker',
    'restApi',
    'privateChannel',
    'headStart',
  ],
};

const CHAINS = ['ton', 'polygon', 'base', 'arbitrum', 'solana', 'tron'] as const;
const FAQ_KEYS = ['trial', 'cancel', 'chains', 'selfHost', 'difference', 'refund'] as const;

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pricing');

  return (
    <section className="relative">
      <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
        {/* Heading */}
        <GsapHeadline
          as="h1"
          className="flex flex-col gap-3 text-center items-center"
          eyebrow={
            <span className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
              {t('eyebrow')}
            </span>
          }
          title={t('title')}
          sub={t('sub')}
          titleClassName="display text-[var(--fg)] text-balance text-[36px] sm:text-[44px] lg:text-[52px] leading-[1.05] tracking-tight font-semibold"
          subClassName="mt-4 text-[15px] leading-relaxed text-[var(--fg-2)] max-w-[60ch] mx-auto"
        />

        {/* Tier cards */}
        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-4">
          {TIERS.map((tier, idx) => (
            <MotionReveal key={tier.key} delay={idx * 80}>
              <TierCard tier={tier} t={t} featureKeys={FEATURE_KEYS[tier.key]} />
            </MotionReveal>
          ))}
        </div>

        {/* Trial callout */}
        <MotionReveal delay={120}>
          <div className="mt-6 border border-[var(--border)] bg-[var(--surface)] px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <span className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--accent)] whitespace-nowrap">
              {t('trial.label')}
            </span>
            <p className="text-[13.5px] leading-relaxed text-[var(--fg-2)] flex-1">
              <span className="text-[var(--fg)] font-medium">{t('trial.title')}</span>
              {' — '}
              {t('trial.body')}
            </p>
          </div>
        </MotionReveal>

        {/* Accepted payments */}
        <section className="mt-20">
          <header className="text-center mb-8 flex flex-col items-center gap-2">
            <p className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
              {t('chains.eyebrow')}
            </p>
            <h2 className="display text-[var(--fg)] text-balance text-[24px] sm:text-[28px] lg:text-[32px] leading-[1.1] tracking-tight font-semibold">
              {t('chains.title')}
            </h2>
            <p className="text-[14px] leading-relaxed text-[var(--fg-2)] max-w-[64ch]">
              {t('chains.sub')}
            </p>
          </header>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {CHAINS.map((chain, idx) => (
              <MotionReveal key={chain} delay={idx * 50}>
                <ChainCard chain={chain} t={t} />
              </MotionReveal>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="mt-20">
          <header className="text-center mb-10 flex flex-col items-center gap-2">
            <p className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
              {t('faq.eyebrow')}
            </p>
            <h2 className="display text-[var(--fg)] text-balance text-[24px] sm:text-[28px] lg:text-[32px] leading-[1.1] tracking-tight font-semibold">
              {t('faq.title')}
            </h2>
          </header>

          <div className="max-w-[760px] mx-auto flex flex-col gap-6">
            {FAQ_KEYS.map((k) => (
              <div
                key={k}
                className="border-b border-[var(--border)] pb-5 last:border-b-0"
              >
                <h3 className="text-[15px] font-semibold text-[var(--fg)] mb-2">
                  {t(`faq.items.${k}.q`)}
                </h3>
                <p className="text-[14px] leading-relaxed text-[var(--fg-2)]">
                  {t(`faq.items.${k}.a`)}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Self-host CTA */}
        <MotionReveal delay={120}>
          <div className="mt-20 border border-[var(--border)] bg-[var(--surface)] p-8 sm:p-10 flex flex-col gap-5 items-start">
            <div className="flex flex-col gap-2">
              <p className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
                {t('selfHost.eyebrow')}
              </p>
              <h3 className="display text-[var(--fg)] text-balance text-[24px] sm:text-[28px] leading-[1.1] tracking-tight font-semibold">
                {t('selfHost.title')}
              </h3>
              <p className="max-w-[60ch] text-[14.5px] leading-relaxed text-[var(--fg-2)]">
                {t('selfHost.sub')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <CtaPrimary href="/docs/quickstart">
                {t('selfHost.primary')}
              </CtaPrimary>
              <CtaSecondary href="https://github.com/7ayLabs/vizzor" external>
                {t('selfHost.secondary')}
              </CtaSecondary>
              <CopyChip command="docker compose up -d" />
            </div>
          </div>
        </MotionReveal>
      </div>
    </section>
  );
}

/* ────────────── tier card ────────────── */

function TierCard({
  tier,
  t,
  featureKeys,
}: {
  tier: Tier;
  t: Awaited<ReturnType<typeof getTranslations<'pricing'>>>;
  featureKeys: readonly string[];
}) {
  const highlighted = tier.highlighted;
  const tierT = (k: string) => t(`tiers.${tier.key}.${k}`);
  const annualSub = safe(t, `tiers.${tier.key}.annualSub`);
  const everythingIn = safe(t, `tiers.${tier.key}.everythingIn`);

  return (
    <div
      className={`
        relative flex h-full flex-col border bg-[var(--surface)] p-6 sm:p-7
        ${
          highlighted
            ? 'border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]'
            : 'border-[var(--border)]'
        }
      `}
    >
      {highlighted && (
        <span
          className="
            absolute -top-2.5 left-6
            mono tabular text-[9.5px] uppercase tracking-[0.16em]
            bg-[var(--accent)] text-[var(--accent-fg)]
            px-2 py-0.5
          "
        >
          {t('mostPopular')}
        </span>
      )}

      {/* Name + sub */}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[22px] font-semibold tracking-tight text-[var(--fg)]">
          {tierT('name')}
        </h3>
        <p className="text-[13px] leading-relaxed text-[var(--fg-2)]">
          {tierT('sub')}
        </p>
      </div>

      {/* Price */}
      <div className="mt-6 flex flex-col gap-1">
        <div className="flex items-baseline gap-1.5">
          <span className="display text-[var(--fg)] text-[40px] sm:text-[44px] leading-none font-semibold mono tabular">
            {tierT('price')}
          </span>
          <span className="text-[13px] text-[var(--fg-3)]">
            {tierT('priceUnit')}
          </span>
        </div>
        {annualSub && (
          <p className="mono tabular text-[10.5px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
            {annualSub}
          </p>
        )}
      </div>

      {/* Primary CTA (monthly) */}
      <div className="mt-6">
        <a
          href={tier.ctaHref}
          target="_blank"
          rel="noopener"
          className={`
            inline-flex w-full items-center justify-center gap-2
            text-[13px] font-semibold tracking-tight
            transition-colors h-11 px-4
            ${
              tier.ctaVariant === 'primary'
                ? 'bg-[var(--fg)] text-[var(--bg)] hover:opacity-90'
                : 'border border-[var(--border)] text-[var(--fg)] hover:bg-[var(--surface-2)]'
            }
          `}
        >
          <span>{tierT('cta')}</span>
          <span aria-hidden>→</span>
        </a>
      </div>

      {/* Secondary cadence CTAs — annual + lifetime when applicable.
          Each is a real deep-link to the bot with its own payment
          payload, so the lifetime $2,499 is actually purchasable. */}
      {tier.altCadences.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {tier.altCadences.map((cadence) => (
            <li key={cadence}>
              <a
                href={cadenceHref(tier.key, cadence)}
                target="_blank"
                rel="noopener"
                className="
                  group flex items-center justify-between gap-2
                  border border-[var(--border)] bg-transparent
                  px-3 py-2 text-[12px] text-[var(--fg-2)]
                  hover:bg-[var(--surface-2)] hover:text-[var(--fg)]
                  transition-colors
                "
              >
                <span className="truncate">
                  {t(`tiers.${tier.key}.cadences.${cadence}.label`)}
                </span>
                <span
                  aria-hidden
                  className="text-[var(--fg-3)] group-hover:text-[var(--fg)] transition-colors"
                >
                  →
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {/* Feature list */}
      <div className="mt-6 flex flex-col gap-3">
        {everythingIn && (
          <p className="text-[12px] text-[var(--fg-2)] font-medium">
            {everythingIn}
          </p>
        )}
        <ul className="flex flex-col gap-2.5">
          {featureKeys.map((k) => (
            <li
              key={k}
              className="flex items-start gap-2 text-[13px] leading-relaxed text-[var(--fg-2)]"
            >
              <Check
                size={13}
                strokeWidth={2.2}
                className="mt-1 shrink-0 text-[var(--accent)]"
                aria-hidden
              />
              <span>{t(`tiers.${tier.key}.features.${k}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ────────────── chain card ────────────── */

function ChainCard({
  chain,
  t,
}: {
  chain: string;
  t: Awaited<ReturnType<typeof getTranslations<'pricing'>>>;
}) {
  const phase = t(`chains.items.${chain}.phase`);
  const isPhase1 = phase === '1';
  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold tracking-tight text-[var(--fg)]">
          {t(`chains.items.${chain}.name`)}
        </h3>
        <span
          className={`
            mono tabular text-[9.5px] uppercase tracking-[0.14em] px-2 py-0.5
            ${
              isPhase1
                ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                : 'border border-[var(--border)] text-[var(--fg-3)]'
            }
          `}
        >
          {isPhase1 ? t('chains.phase1Label') : t('chains.phase2Label')}
        </span>
      </div>
      <p className="mono tabular text-[10.5px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
        {t(`chains.items.${chain}.token`)}
      </p>
      <p className="text-[12.5px] leading-relaxed text-[var(--fg-2)]">
        {t(`chains.items.${chain}.strategy`)}
      </p>
    </div>
  );
}

/**
 * Safely read an i18n key; return null if it's absent (so we can omit
 * the annual line on tiers that don't have one, like Free).
 */
function safe(
  t: Awaited<ReturnType<typeof getTranslations<'pricing'>>>,
  key: string,
): string | null {
  try {
    const v = t(key);
    return v && v !== key ? v : null;
  } catch {
    return null;
  }
}
