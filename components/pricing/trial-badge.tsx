'use client';

/**
 * TrialBadge — small inline "Prueba · Nd" chip mounted next to the
 * Pro card's price. Renders only when the connected wallet is in the
 * 7-day Pro trial window. The Pro card is the natural mount point
 * because trial wallets get Pro-equivalent tool-use breadth from the
 * engine.
 *
 * Reads from `ActivePlanIsland` context — no extra fetch. Returns
 * `null` for free, paid, and unconnected wallets.
 */

import { useActivePlan } from './active-plan-island';

interface TrialBadgeProps {
  cardTier: 'free' | 'pro' | 'elite';
  /** i18n template, e.g. "Prueba · {days}d". The component substitutes
   *  `{days}` with the integer remaining days. */
  template: string;
}

export function TrialBadge({ cardTier, template }: TrialBadgeProps) {
  const { isTrial, trialDaysRemaining } = useActivePlan();
  if (cardTier !== 'pro') return null;
  if (!isTrial) return null;
  // Floor at 1 — the resolver may return 0 if the trial elapses mid-render.
  const days = Math.max(1, trialDaysRemaining);
  // `%days%` delimiter — chosen because next-intl / ICU MessageFormat
  // would reserve `{days}` as a placeholder and emit a warning when
  // no `values` are passed to t(). `%days%` survives the i18n parser
  // intact so we can do the substitution here at render time.
  const label = template.replace('%days%', String(days));
  return (
    <span
      className="
        mono tabular text-[10px] uppercase tracking-[0.18em] font-semibold
        inline-flex items-center gap-1 px-2 py-1 rounded-full
        border border-[var(--accent)]/40 text-[var(--accent)]
      "
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)]"
      />
      {label}
    </span>
  );
}
