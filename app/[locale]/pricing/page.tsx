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
import { GsapHeadline } from '@/components/ui/gsap-headline';
import { MotionReveal } from '@/components/ui/motion-reveal';
import { LifetimePromoIsland } from '@/components/pricing/lifetime-promo-island';

type Cadence = 'monthly' | 'annual' | 'lifetime';
type TierKey = 'free' | 'pro' | 'elite';

interface Tier {
  key: TierKey;
  ctaHref: string;
  ctaVariant: 'primary' | 'outline';
  external?: boolean;
  /** Alternative billing cycles, rendered as inline links under the
   *  price. Empty for Free. */
  altCadences: ReadonlyArray<Cadence>;
}

const TIERS: ReadonlyArray<Tier> = [
  {
    key: 'free',
    // Free tier now CTAs into /predict — the 7-day Pro trial auto-starts
    // on first SIWS connect. Telegram still works as an alternative
    // entry point (the bot grants its own 7-day trial on /start), but
    // the headline CTA is the on-site flow now.
    ctaHref: '/predict',
    ctaVariant: 'outline',
    external: false,
    altCadences: [],
  },
  {
    key: 'pro',
    // Cadence CTAs route to the on-site checkout shell at
    // /pay/[tier]/[cadence]. The shell handles wallet connect +
    // payment session + grant-code handoff.
    ctaHref: '/pay/pro/monthly',
    ctaVariant: 'primary',
    altCadences: ['annual'],
  },
  {
    key: 'elite',
    ctaHref: '/pay/elite/monthly',
    ctaVariant: 'primary',
    altCadences: ['annual', 'lifetime'],
  },
];

function cadenceHref(tier: TierKey, cadence: Cadence): string {
  return `/pay/${tier}/${cadence}`;
}

/**
 * Feature groups per tier — each key resolves to a `{title, body}`
 * pair in the messages JSON. Groups are intentionally consolidated so
 * each tier card scans in a single glance: 5 on Free, 6 on Pro and
 * Elite. Adding a key here means adding both `title` and `body` under
 * the same path in en / es / fr.
 */
const FEATURE_KEYS: Record<TierKey, readonly string[]> = {
  free: ['scanner', 'security', 'context', 'discovery', 'trial'],
  pro: ['predictor', 'tiers', 'families', 'aiChat', 'diagnose', 'audit'],
  elite: ['whaleTerminal', 'smartMoney', 'forensics', 'preNews', 'crossVenue', 'api'],
};

const CHAINS = ['solana', 'ton'] as const;
const FAQ_KEYS = ['trial', 'cancel', 'chains', 'difference', 'refund'] as const;

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
      {/* Lifetime promo modal — auto-opens once per visitor, 30d
          suppress on dismiss, re-trigger via floating pill. */}
      <LifetimePromoIsland />
      <div className="mx-auto w-full max-w-[1180px] px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
        {/* Heading — single centered display word, no eyebrow / sub.
            Ollama-style: the cards do the talking. */}
        <GsapHeadline
          as="h1"
          className="flex flex-col gap-3 text-center items-center"
          title={t('title')}
          titleClassName="display text-[var(--fg)] text-balance text-[48px] sm:text-[60px] lg:text-[72px] leading-[1.0] tracking-tight font-semibold"
        />

        {/* Tier cards */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6">
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
  const tierT = (k: string) => t(`tiers.${tier.key}.${k}`);
  const everythingIn = safe(t, `tiers.${tier.key}.everythingIn`);
  const hasAnnual = tier.altCadences.includes('annual');
  const hasLifetime = tier.altCadences.includes('lifetime');

  return (
    <div className="relative flex h-full flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-7 sm:p-8">
      {/* 1. Tier name */}
      <h2 className="display text-[32px] sm:text-[36px] leading-none tracking-tight font-semibold text-[var(--fg)]">
        {tierT('name')}
      </h2>

      {/* 2. One-line tagline */}
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--fg-2)]">
        {tierT('sub')}
      </p>

      {/* 3. Price */}
      <div className="mt-7 flex flex-col gap-1.5">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[var(--fg)] text-[34px] sm:text-[38px] leading-none font-semibold mono tabular">
            {tierT('price')}
          </span>
          <span className="text-[15px] text-[var(--fg-3)]">
            {tierT('priceUnit')}
          </span>
        </div>

        {/* 4. Inline annual / lifetime sub-line — Ollama pattern:
            "or $99/yr billed annually" with the cadence word underlined
            as a real link to the checkout shell. */}
        {hasAnnual && (
          <p className="text-[13.5px] text-[var(--fg-3)]">
            {t('orPrefix')}{' '}
            <a
              href={cadenceHref(tier.key, 'annual')}
              className="text-[var(--fg-2)] underline underline-offset-4 hover:text-[var(--fg)] transition-colors"
            >
              {t(`tiers.${tier.key}.cadences.annual.inline`)}
            </a>
          </p>
        )}
        {hasLifetime && (
          <p className="text-[13.5px] text-[var(--fg-3)]">
            {t('orPrefix')}{' '}
            <a
              href={cadenceHref(tier.key, 'lifetime')}
              className="text-[var(--fg-2)] underline underline-offset-4 hover:text-[var(--fg)] transition-colors"
            >
              {t(`tiers.${tier.key}.cadences.lifetime.inline`)}
            </a>
          </p>
        )}
      </div>

      {/* 5. Primary CTA — full-width pill button.
          Free deep-links Telegram in a new tab; paid tiers route to
          the on-site /pay checkout shell. */}
      <div className="mt-7">
        <a
          href={tier.ctaHref}
          {...(tier.external
            ? { target: '_blank', rel: 'noopener' }
            : {})}
          className={`
            inline-flex w-full items-center justify-center
            h-12 rounded-full px-5
            text-[14px] font-semibold tracking-tight
            transition-[transform,opacity] duration-150
            ${
              tier.ctaVariant === 'primary'
                ? 'bg-[var(--fg)] text-[var(--bg)] hover:opacity-90 motion-safe:hover:scale-[1.01]'
                : 'border border-[var(--fg)] text-[var(--fg)] hover:bg-[var(--surface-2)]'
            }
          `}
        >
          <span>{tierT('cta')}</span>
        </a>
      </div>

      {/* 6. "Everything in Free, plus:" label + check-bulleted feature
          list. The label is bolder so the eye lands on it first. */}
      <div className="mt-8 flex flex-col gap-4">
        {everythingIn && (
          <p className="text-[14px] font-semibold text-[var(--fg)]">
            {everythingIn}
          </p>
        )}
        <ul className="flex flex-col gap-4">
          {featureKeys.map((k) => (
            <li key={k} className="flex items-start gap-3">
              <Check
                size={15}
                strokeWidth={2.2}
                className="mt-[3px] shrink-0 text-[var(--fg)]"
                aria-hidden
              />
              <div className="flex flex-col gap-0.5">
                <p className="text-[13.5px] font-semibold leading-snug text-[var(--fg)]">
                  {t(`tiers.${tier.key}.features.${k}.title`)}
                </p>
                <p className="text-[12.5px] leading-relaxed text-[var(--fg-3)]">
                  {t(`tiers.${tier.key}.features.${k}.body`)}
                </p>
              </div>
            </li>
          ))}
        </ul>
        {/* Free tier shows the actual command surface as a footnote
            line beneath the bullets — it's reference info, not a
            sellable feature, so it doesn't earn a check bullet. */}
        {tier.key === 'free' && (
          <p className="mt-2 mono tabular text-[10.5px] leading-relaxed text-[var(--fg-3)] uppercase tracking-[0.08em]">
            {safe(t, 'tiers.free.commandsLine')}
          </p>
        )}
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
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[16px] font-semibold tracking-tight text-[var(--fg)]">
          {t(`chains.items.${chain}.name`)}
        </h3>
        <span className="mono tabular text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 rounded-md bg-[var(--fg)] text-[var(--bg)]">
          {t(`chains.items.${chain}.discount`)}
        </span>
      </div>
      <p className="mono tabular text-[10.5px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
        {t(`chains.items.${chain}.token`)}
      </p>
      <p className="text-[13px] leading-relaxed text-[var(--fg-2)]">
        {t(`chains.items.${chain}.strategy`)}
      </p>
    </div>
  );
}

/**
 * Safely read an i18n key — uses next-intl's `t.has()` to check the
 * key's existence WITHOUT triggering the `MISSING_MESSAGE` error path
 * (which logs to stderr even when wrapped in try/catch).
 */
function safe(
  t: Awaited<ReturnType<typeof getTranslations<'pricing'>>>,
  key: string,
): string | null {
  // `t.has` is available in next-intl >=3.x and doesn't throw.
  const has = (t as unknown as { has?: (k: string) => boolean }).has;
  if (typeof has === 'function' && !has.call(t, key)) return null;
  try {
    const v = t(key);
    return v && v !== key ? v : null;
  } catch {
    return null;
  }
}
