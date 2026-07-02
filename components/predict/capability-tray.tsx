'use client';

/**
 * CapabilityTray — four agent-payment icons that surface on the
 * composer when the user is talking about a token.
 *
 * Visibility:
 *   The tray only renders when `activeSymbols.length > 0`. That set
 *   is the union of tickers from the carousel (`tokenPills`) and
 *   tickers the user typed inline as `$XXX` pills — the same source
 *   of truth the overlay parser uses. This is why the tray "just
 *   appears" the moment a ticker is present regardless of how the
 *   user got there.
 *
 * Click behaviour:
 *   Clicking any icon (enabled or not, free tier or paid) opens
 *   the CapabilityActionModal upstream. The modal internally handles:
 *     - Free tier → "Upgrade" nudge
 *     - Enabled=false → inline TOS accept + enable
 *     - Enabled=true → intent draft form → sign + settle
 *   This means clicking is always meaningful — never a no-op — even
 *   before the wallet has any settings configured.
 *
 * State machine (per icon, purely visual):
 *   off    → wallet hasn't armed it in this turn
 *   armed  → wallet clicked and the action modal produced an intent
 *            (breathing pulse until submit clears the state)
 *   locked → wallet hasn't enabled this capability in settings, OR
 *            wallet is on the free tier. Icon is dimmed — still
 *            clickable so the modal can walk them through enable.
 *
 * X402 grounding: whether the engine emits an intent_required or the
 * user drafts one manually via the modal, the settlement flow is
 * identical — canonical bytes signed by the wallet, verified by
 * /api/execute-intent, forwarded to the engine's /v1/execute-intent.
 */

import { useMemo } from 'react';
import { CalendarClock, DollarSign } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { ALL_CAP_IDS, type CapId } from '@/lib/capabilities/intent';

interface CapabilityTrayProps {
  /** Union of carousel + typed ticker symbols. Empty → tray hidden. */
  activeSymbols: readonly string[];
  /** Which capabilities have an intent drafted this turn. Visual only. */
  armed: ReadonlySet<CapId>;
  /** Which capabilities have a command currently typed in the textbox
   *  — even a partial one like `send 0.1 BTC → `. Drives the icon
   *  accent so the $ turns green the moment the template lands. */
  drafting?: ReadonlySet<CapId>;
  /** Which capabilities the wallet has explicitly enabled in settings. */
  enabled: ReadonlySet<CapId>;
  /**
   * Free-tier / unauthenticated wallet: all four icons render dimmed
   * and their tooltip points at Pro. Clicking still opens the modal
   * so the user gets the "Upgrade to Pro" nudge in place — no
   * dead-end interactions.
   */
  tierLocked: boolean;
  /** Streaming in progress → interactions disabled. */
  disabled?: boolean;
  /**
   * Capability whose CapabilityActionModal is currently open. The
   * matching icon paints its accent color for instant click feedback
   * — the user sees the hue immediately instead of waiting for the
   * intent draft to succeed and flip the `armed` state.
   */
  currentAction?: CapId | null;
  /** Called when the user clicks a capability icon. Parent opens
   *  the CapabilityActionModal keyed on the clicked capability. */
  onOpenAction: (cap: CapId) => void;
  className?: string;
}

interface CapIconSpec {
  id: CapId;
  Icon: typeof DollarSign;
  /** CSS variable providing the accent hue when this capability is
   *  armed. Defined in globals.css → `--cap-{id}`. */
  accentVar: string;
}

// v0.5.1 shipping scope: transfer (send) + payment (schedule).
// Reads left-to-right as "move money now → move money later".
const CAP_ICONS: readonly CapIconSpec[] = [
  { id: 'transfer', Icon: DollarSign, accentVar: '--cap-transfer' },
  { id: 'payment', Icon: CalendarClock, accentVar: '--cap-payment' },
];

export function CapabilityTray({
  activeSymbols,
  armed,
  drafting,
  enabled,
  tierLocked,
  disabled = false,
  currentAction = null,
  onOpenAction,
  className,
}: CapabilityTrayProps) {
  const t = useTranslations('predict.capability.tray');

  // The keyframe fires on mount. Reset the animation whenever the
  // ticker set changes so a tray already visible for BTC re-animates
  // when the user swaps to ETH — visual reinforcement that the tools
  // are relevant to the NEW ticker.
  const trayKey = useMemo(
    () => activeSymbols.slice().sort().join(','),
    [activeSymbols],
  );

  if (activeSymbols.length === 0) return null;

  return (
    <div
      key={trayKey}
      data-tour-id="capability-tray"
      className={cn(
        'flex flex-wrap items-center gap-1 self-end mb-px',
        'transition-opacity duration-150',
        className,
      )}
      role="toolbar"
      aria-label={t('label')}
    >
      {CAP_ICONS.map(({ id, Icon, accentVar }, idx) => {
        const isArmed = armed.has(id);
        const isCurrent = currentAction === id;
        const isDrafting = drafting?.has(id) ?? false;
        const isAccented = isArmed || isCurrent || isDrafting;
        const isLocked = tierLocked || !enabled.has(id);
        const tooltipKey = isLocked
          ? tierLocked
            ? 'lockedTier'
            : 'lockedSettings'
          : `${id}.tooltip`;
        // Accented icons paint the capability hue ONTO THE GLYPH
        // ONLY — no background tint, no border ring, no glow. The
        // row reads as a legend at a glance ($ green = transfer,
        // violet = workflow, amber = payment, blue = autonomous)
        // without competing chrome around each icon.
        const accentStyle: React.CSSProperties = isAccented
          ? { animationDelay: `${idx * 40}ms`, color: `var(${accentVar})` }
          : { animationDelay: `${idx * 40}ms` };
        return (
          <button
            key={id}
            type="button"
            // Click always opens the action modal. Modal handles the
            // enable / draft / sign transitions internally so the
            // tray icon never no-ops silently.
            onClick={() => {
              if (disabled) return;
              onOpenAction(id);
            }}
            disabled={disabled}
            aria-pressed={isArmed}
            aria-label={t(`${id}.label`)}
            title={t(tooltipKey)}
            // Staggered entrance — 40ms between icons so the row
            // "unfurls" rather than snapping in all at once. The
            // per-key `trayKey` above resets this whenever tickers
            // change so the same effect fires again.
            style={accentStyle}
            className={cn(
              'vz-tray-in',
              'inline-flex h-8 w-8 sm:h-7 sm:w-7 items-center justify-center rounded-full',
              'transition-[color,transform,opacity] duration-150 ease-out',
              'active:scale-95 cursor-pointer bg-transparent',
              isLocked && !isAccented
                ? // Locked: dimmed but tappable — clicking still
                  // opens the enable/upgrade modal so the user never
                  // hits a dead end.
                  'text-[var(--fg-3)] opacity-50 hover:opacity-90'
                : isAccented
                  ? // Accented (armed / current / drafting): color
                    // comes from `accentStyle` inline. No border, no
                    // background, no pulse — the glyph itself carries
                    // the hue.
                    ''
                  : // Off: ghost. Hover brightens the glyph without
                    // adding chrome around it.
                    'text-[var(--fg-3)] hover:text-[var(--fg)]',
            )}
          >
            <Icon size={14} strokeWidth={2} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

export const CAPABILITY_TRAY_IDS = ALL_CAP_IDS;
