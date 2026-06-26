'use client';

/**
 * TierCtaButton — wallet-aware primary CTA for a single /pricing tier
 * card. Reads the active plan from `ActivePlanIsland` context and
 * swaps between three render modes:
 *
 *   `current`         — disabled pill labelled "Plan actual" + a small
 *                       "Gestionar" secondary link to /account.
 *   `coveredByHigher` — disabled pill labelled "Incluido en Elite"
 *                       (user is on Elite, looking at Pro card).
 *   default           — the original `<a href={ctaHref}>` link with the
 *                       primary / outline visual variants.
 *
 * Kept as a focused client island so the surrounding TierCard can stay
 * server-rendered. The TierCard mounts this component in the same slot
 * where the static `<a>` used to live.
 */

import { useActiveMatchFor } from './active-plan-island';

type TierKey = 'free' | 'pro' | 'elite';
type Cadence = 'monthly' | 'annual' | 'lifetime';
type Variant = 'primary' | 'outline';

interface TierCtaButtonProps {
  cardTier: TierKey;
  /** The card's primary CTA cadence — matches `/pay/{tier}/{cadence}`
   *  in the default href. Used to discriminate the "current plan"
   *  match against the user's subscribed cadence. */
  cardCadence: Cadence;
  defaultHref: string;
  defaultLabel: string;
  variant: Variant;
  external?: boolean;
  /** Localized label used when the card matches the user's current
   *  subscription. */
  currentPlanLabel: string;
  /** Localized label used when the user is on Elite viewing the Pro
   *  card (Pro features are included). */
  includedInHigherLabel: string;
  /** Localized "Manage plan" secondary label. */
  manageLabel: string;
  manageHref: string;
}

export function TierCtaButton({
  cardTier,
  cardCadence,
  defaultHref,
  defaultLabel,
  variant,
  external = false,
  currentPlanLabel,
  includedInHigherLabel,
  manageLabel,
  manageHref,
}: TierCtaButtonProps) {
  const match = useActiveMatchFor(cardTier, cardCadence);

  if (match === 'current') {
    return (
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          disabled
          aria-disabled
          className={cn(
            BASE_CTA_CLASSES,
            // Filled but desaturated — reads as "claimed" not "active".
            'bg-[var(--surface-2)] text-[var(--fg-2)] cursor-default',
            'border border-[var(--border-hi)]',
          )}
        >
          <CheckGlyph />
          <span>{currentPlanLabel}</span>
        </button>
        <a
          href={manageHref}
          className={cn(
            'mono tabular text-[10.5px] uppercase tracking-[0.18em]',
            'text-[var(--fg-3)] hover:text-[var(--fg)] transition-colors',
          )}
        >
          {manageLabel}
        </a>
      </div>
    );
  }

  if (match === 'coveredByHigher') {
    return (
      <button
        type="button"
        disabled
        aria-disabled
        className={cn(
          BASE_CTA_CLASSES,
          'bg-[var(--surface-2)] text-[var(--fg-2)] cursor-default',
          'border border-[var(--border-hi)]',
        )}
      >
        <CheckGlyph />
        <span>{includedInHigherLabel}</span>
      </button>
    );
  }

  // Default — render the original CTA shape.
  return (
    <a
      href={defaultHref}
      {...(external ? { target: '_blank', rel: 'noopener' } : {})}
      className={cn(
        BASE_CTA_CLASSES,
        variant === 'primary'
          ? 'bg-[var(--fg)] text-[var(--bg)] hover:opacity-90 motion-safe:hover:scale-[1.01]'
          : 'border border-[var(--fg)] text-[var(--fg)] hover:bg-[var(--surface-2)]',
      )}
    >
      <span>{defaultLabel}</span>
    </a>
  );
}

const BASE_CTA_CLASSES = [
  'inline-flex w-full items-center justify-center gap-2',
  'h-12 rounded-full px-5',
  'text-[14px] font-semibold tracking-tight',
  'transition-[transform,opacity] duration-150',
].join(' ');

function CheckGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3.5 8.5l3 3 6-6.5" />
    </svg>
  );
}

function cn(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
