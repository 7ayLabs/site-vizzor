'use client';

/**
 * ThemeToggle — minimal chromeless icon button cycling light → dark → system.
 *
 * Why three states?
 *   The default for first-time visitors is `'system'`, which means a
 *   mobile user on iOS dark mode lands on dark and the site tracks
 *   the OS in real time (Settings → Display → Dark, or Auto sundown
 *   schedules). If the toggle only flipped between `light` and `dark`,
 *   the first tap would lock the theme forever — `'system'` becomes a
 *   one-way door. The third stop lets the user opt back into "follow
 *   my phone" without clearing site data.
 *
 * Visual contract:
 *   - Borderless icon button on the bar's chromeless vocabulary.
 *   - Sun / Moon / Monitor — one is visible at a time, others scale-0
 *     + opacity-0 so the swap reads as a single rotation tween over
 *     260ms. Monitor icon signals "synced with OS" — clicking again
 *     leaves system-follow mode and returns to a fixed `light`.
 *   - The aria-label describes what the *next* tap will do, not the
 *     current state, so screen readers announce the action.
 */

import { Moon, Sun, MonitorSmartphone } from 'lucide-react';
import { useTheme } from './theme-provider';

export function ThemeToggle() {
  const { theme, cycle } = useTheme();

  const nextLabel =
    theme === 'light'
      ? 'Switch to dark mode'
      : theme === 'dark'
        ? 'Sync theme with system'
        : 'Switch to light mode';

  // Each icon: present when matching theme, otherwise scale-0 +
  // opacity-0 with a slight rotation to give the swap directionality.
  const iconClass = (active: boolean, rotateOut: string) =>
    `absolute transition-all duration-260 ease-out ${
      active
        ? 'rotate-0 scale-100 opacity-100'
        : `${rotateOut} scale-0 opacity-0`
    }`;

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={nextLabel}
      title={
        theme === 'system'
          ? 'Theme: system (tap to override)'
          : `Theme: ${theme}`
      }
      className="
        group relative inline-flex h-8 w-8 items-center justify-center
        text-[var(--pref-trigger,var(--fg-3))]
        transition-[color,transform] duration-200 ease-out
        hover:text-[var(--pref-trigger-hover,var(--fg))] hover:scale-[1.06]
        active:scale-[0.94]
        focus-visible:outline-none focus-visible:ring-2
        focus-visible:ring-[var(--accent)] focus-visible:rounded-md
      "
    >
      <Sun
        size={16}
        strokeWidth={1.75}
        className={iconClass(theme === 'light', 'rotate-90')}
      />
      <Moon
        size={16}
        strokeWidth={1.75}
        className={iconClass(theme === 'dark', '-rotate-90')}
      />
      <MonitorSmartphone
        size={16}
        strokeWidth={1.75}
        className={iconClass(theme === 'system', 'rotate-45')}
      />
    </button>
  );
}
