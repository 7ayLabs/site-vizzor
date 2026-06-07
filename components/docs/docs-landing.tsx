/**
 * Docs landing — the custom hero + category grid rendered at `/docs`.
 *
 * Replaces the default Fumadocs prose rendering for the root slug.
 * Inner doc pages (`/docs/predictor`, `/docs/scanner`, etc.) still
 * use the standard MDX renderer with the Fumadocs sidebar shell.
 *
 * Visual contract:
 *   - Full-bleed hero with display headline, subtitle, and two CTAs.
 *   - Subtle radial-grain texture on the hero background — adds depth
 *     without breaking strict B&W discipline.
 *   - Category grid below the hero, organized by the same IA as
 *     content/docs/meta.json (Surfaces / Predictor / Intelligence /
 *     Automation / Plans / Reference).
 *   - Each category card has a label, a brief, and a list of in-section
 *     pages with arrow affordances. Hover lifts the card.
 *   - Final strip with a "What's new" line and a tertiary CTA.
 *
 * Server component — no client state needed.
 */

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';

// Docs routes are MDX-derived (not in the typed-routes manifest), so
// we widen here to the Route type at the callsite. Every href below
// is a stable internal path; runtime routing is unaffected.
type DocsRoute = string;

interface CategoryLink {
  href: DocsRoute;
  label: string;
  /** One-line value statement — what this page actually gets you. */
  blurb: string;
  /** Optional tag rendered as a `mono tabular` chip on the right. */
  tag?: string;
}

interface Category {
  /** Roman-numeral or letter chip rendered in the card corner — keeps
   *  the index feel without leaning on stock iconography. */
  marker: string;
  eyebrow: string;
  title: string;
  body: string;
  links: ReadonlyArray<CategoryLink>;
}

const CATEGORIES: ReadonlyArray<Category> = [
  {
    marker: 'I',
    eyebrow: 'Predictor',
    title: 'Directional forecasts, calibrated.',
    body: 'Four tiers from advisory to high-conviction, every horizon from 5m to 7d plus arbitrary durations, transparent abstention when the data isn\'t there. When Vizzor says 63%, it means 63%.',
    links: [
      {
        href: '/docs/predictor',
        label: 'The Predictor',
        blurb: 'Tiers, horizons, abstention, what /predict actually returns.',
      },
      {
        href: '/docs/chronovisor',
        label: 'ChronoVisor engine',
        blurb: 'CF algebra, Bayesian update, Platt calibration, FOL rules.',
        tag: 'math',
      },
      {
        href: '/docs/signals',
        label: 'Signal families',
        blurb: 'Six independent families fused into every forecast.',
        tag: '6 fused',
      },
    ],
  },
  {
    marker: 'II',
    eyebrow: 'Intelligence',
    title: 'Pre-trade & forensics.',
    body: 'Where the engine gets its inputs and the operator gets the receipts — Scanner, Whale Terminal, the full forensics suite, pre-news signals, cross-venue intel, and the multi-LLM chat that orchestrates them.',
    links: [
      {
        href: '/docs/scanner',
        label: 'Token Scanner',
        blurb: 'Rug risk, honeypot, tax logic, ownership, holders.',
        tag: 'free',
      },
      {
        href: '/docs/whale-terminal',
        label: 'Whale Terminal',
        blurb: 'Smart Money Flow, top-20 holder labeling, per-token feed.',
      },
      {
        href: '/docs/forensics',
        label: 'Forensics suite',
        blurb: 'Flow-graph, rug detector, contract auditor, disassembler.',
      },
      {
        href: '/docs/pre-news',
        label: 'Pre-news',
        blurb: 'SEC EDGAR, token unlocks, options IV / skew, LLM catalyst.',
      },
      {
        href: '/docs/cross-venue',
        label: 'Cross-venue',
        blurb: 'Premium spreads, funding-z divergence, Polymarket edge.',
      },
      {
        href: '/docs/ai-chat',
        label: 'AI chat',
        blurb: 'Multi-LLM with tool-use. Claude · GPT · Gemini · Ollama.',
        tag: 'tool-use',
      },
    ],
  },
  {
    marker: 'III',
    eyebrow: 'Surfaces',
    title: 'How you reach Vizzor.',
    body: 'Same engine, four envelopes. Telegram is the primary surface; the REST API, CLI, and Discord bot all read from the identical record shape so a prediction renders the same everywhere.',
    links: [
      {
        href: '/docs/telegram',
        label: 'Telegram bot',
        blurb: '32 user + admin commands, runtime allowlist, role-scoped menus.',
        tag: 'primary',
      },
      {
        href: '/docs/discord',
        label: 'Discord bot',
        blurb: 'Slash commands + @mention chat. Same engine, different envelope.',
      },
      {
        href: '/docs/cli',
        label: 'CLI & TUI',
        blurb: 'Every command in the terminal + the Ink-based interactive shell.',
      },
      {
        href: '/docs/api',
        label: 'REST API',
        blurb: '40+ endpoints, SSE-streamed chat, WebSocket push.',
        tag: 'OpenAPI',
      },
    ],
  },
  {
    marker: 'IV',
    eyebrow: 'Automation',
    title: 'Autonomous agents.',
    body: 'Set-and-forget think → analyze → decide → act loops. Five built-in strategies, paper or live execution, seven-step safety pipeline. Wallets are required only for live mode.',
    links: [
      {
        href: '/docs/agents',
        label: 'Autonomous agents',
        blurb: 'Strategies, execution modes, safety pipeline, kill switches.',
      },
    ],
  },
  {
    marker: 'V',
    eyebrow: 'Plans',
    title: 'Billing & access.',
    body: 'Vega — the on-chain billing engine. Tier ladder, payment chains, HD-wallet derivation per user, exchange-rate oracle, auto-trial. No cards, no Stripe, no recurring-charge token.',
    links: [
      {
        href: '/docs/billing',
        label: 'Billing & plans',
        blurb: 'Tier ladder, payment flow, runtime /plans knobs.',
      },
    ],
  },
  {
    marker: 'VI',
    eyebrow: 'Reference',
    title: 'Build, configure, deploy.',
    body: 'Everything you need to run Vizzor on your own infra — eleven supported chains, every runtime knob, the Docker stack with backup and restore.',
    links: [
      {
        href: '/docs/chains',
        label: 'Supported chains',
        blurb: 'EVM, Solana, Sui, Aptos, TON. ChainAdapter interface.',
        tag: '11 live',
      },
      {
        href: '/docs/configuration',
        label: 'Configuration',
        blurb: '~/.vizzor/config.yaml, env vars, runtime knobs over Telegram.',
      },
      {
        href: '/docs/deployment',
        label: 'Deployment',
        blurb: 'Docker compose, prod overlay, backup + restore scripts.',
      },
    ],
  },
];

export function DocsLanding() {
  return (
    <div className="docs-landing">
      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="docs-hero relative isolate overflow-hidden">
        <div
          aria-hidden
          className="docs-hero-grain pointer-events-none absolute inset-0"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 50% 100%, color-mix(in oklab, var(--fg) 6%, transparent), transparent 70%)',
          }}
        />

        <div className="relative mx-auto flex max-w-[1100px] flex-col items-center px-6 pt-20 pb-20 text-center sm:pt-28 sm:pb-28 lg:pt-32 lg:pb-32">
          <p className="mono tabular text-[10.5px] uppercase tracking-[0.22em] text-[var(--fg-3)]">
            Documentation · v0.2.x
          </p>

          {/*
             * Mirror exactly what /pricing and the home hero do —
             * `display` for the type-system utility, the same 44/60/72
             * size ramp, the same tracking and weight. Nothing
             * docs-specific. Inter Variable throughout, no serif.
             */}
          <h1 className="display mt-6 text-balance text-[44px] sm:text-[60px] lg:text-[72px] leading-[1.0] tracking-tight font-semibold text-[var(--fg)]">
            Vizzor Docs
          </h1>

          <p className="mt-6 max-w-[60ch] text-[15px] sm:text-[17px] leading-[1.55] text-[var(--fg-2)]">
            Everything you need to ship with the Vizzor stack — the Predictor, the Whale Terminal, the multi-LLM chat, and eleven chains worth of forensics. Calibrated probabilities, real receipts, no chart-tool fluff.
          </p>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
            <Link
              href={'/docs/quickstart' as Route}
              className="
                inline-flex h-12 items-center justify-center gap-2 rounded-full
                bg-[var(--fg)] px-6 text-[14px] font-semibold tracking-tight
                text-[var(--bg)]
                transition-[transform,opacity] duration-150
                hover:opacity-90 motion-safe:hover:scale-[1.02]
              "
            >
              <span>Start building</span>
              <ArrowRight size={16} strokeWidth={2.4} aria-hidden />
            </Link>
            <Link
              href={'/docs/predictor' as Route}
              className="
                inline-flex h-12 items-center justify-center gap-2 rounded-full
                border border-[var(--border)] bg-[var(--surface)] px-6
                text-[14px] font-semibold tracking-tight text-[var(--fg)]
                transition-[transform,background,opacity] duration-150
                hover:bg-[var(--surface-2)]
              "
            >
              <span>The Predictor</span>
              <ArrowRight size={16} strokeWidth={2.4} aria-hidden />
            </Link>
          </div>

          <p className="mt-6 mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
            English-only for v0.1 · ES / FR translations in v0.2
          </p>
        </div>
      </section>

      {/* ── Category grid ───────────────────────────────────────── */}
      <section className="relative">
        <div className="mx-auto max-w-[1280px] px-6 pt-16 pb-24">
          <div className="grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-2">
            {CATEGORIES.map((cat) => (
              <CategoryCard key={cat.eyebrow} category={cat} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function CategoryCard({ category }: { category: Category }) {
  return (
    <article
      className="
        group relative flex flex-col gap-6
        rounded-2xl border border-[var(--border)] bg-[var(--surface)]
        p-6 sm:p-7
        transition-[transform,border-color,background] duration-200
        hover:border-[var(--fg-3)]
        motion-safe:hover:-translate-y-0.5
      "
    >
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {/* Roman-numeral marker — keeps the index/atlas feel without
              importing iconography. Mirrors the project's mono tabular
              token discipline. */}
          <span
            aria-hidden
            className="
              inline-flex h-7 min-w-7 items-center justify-center
              rounded-full border border-[var(--border)]
              px-2 mono tabular text-[10px] font-semibold
              uppercase tracking-[0.14em] text-[var(--fg-3)]
            "
          >
            {category.marker}
          </span>
          <p className="mono tabular text-[10.5px] uppercase tracking-[0.22em] text-[var(--fg-3)]">
            {category.eyebrow}
          </p>
        </div>

        <h2 className="text-[22px] sm:text-[26px] leading-[1.15] font-semibold tracking-tight text-[var(--fg)]">
          {category.title}
        </h2>

        <p className="text-[14px] leading-[1.6] text-[var(--fg-2)]">
          {category.body}
        </p>
      </header>

      {/* Hairline separator between the framing copy and the link list. */}
      <div aria-hidden className="h-px w-full bg-[var(--border)]" />

      <ul className="flex flex-col gap-0.5">
        {category.links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href as Route}
              className="
                group/row -mx-3 flex items-start gap-3
                rounded-lg px-3 py-3
                transition-colors duration-100
                hover:bg-[var(--surface-2)]
              "
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-semibold tracking-tight text-[var(--fg)]">
                    {link.label}
                  </span>
                  {link.tag ? (
                    <span
                      className="
                        mono tabular text-[9.5px] uppercase tracking-[0.18em]
                        text-[var(--fg-3)]
                        border border-[var(--border)] rounded-md
                        px-1.5 py-0.5
                      "
                    >
                      {link.tag}
                    </span>
                  ) : null}
                </span>
                <span className="text-[12.5px] leading-[1.55] text-[var(--fg-3)]">
                  {link.blurb}
                </span>
              </span>
              <ArrowRight
                size={15}
                strokeWidth={2}
                aria-hidden
                className="
                  mt-1 shrink-0 text-[var(--fg-3)]
                  transition-transform duration-150
                  group-hover/row:translate-x-0.5
                  group-hover/row:text-[var(--fg)]
                "
              />
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}
