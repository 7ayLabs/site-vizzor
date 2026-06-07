'use client';

/**
 * ThemeToggle — minimal chromeless icon button.
 *
 * Header design vocabulary: text + icon, no surface/border chrome.
 * Hover lifts the icon colour to full --fg, brief 1.06× scale for a
 * tactile feel without the rectangle. Active state collapses to .95×.
 * The sun/moon swap is a single tween (rotate + scale + opacity)
 * cross-faded over 260ms so the transition reads as one gesture.
 */

import { Moon, Sun } from 'lucide-react';
import { useTheme } from './theme-provider';

export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const isDark = resolved === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      className="
        group relative inline-flex h-8 w-8 items-center justify-center
        text-[var(--fg-3)]
        transition-[color,transform] duration-200 ease-out
        hover:text-[var(--fg)] hover:scale-[1.06]
        active:scale-[0.94]
        focus-visible:outline-none focus-visible:ring-2
        focus-visible:ring-[var(--accent)] focus-visible:rounded-md
      "
    >
      <Sun
        size={16}
        strokeWidth={1.75}
        className={`absolute transition-all duration-260 ease-out ${
          isDark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'
        }`}
      />
      <Moon
        size={16}
        strokeWidth={1.75}
        className={`absolute transition-all duration-260 ease-out ${
          isDark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0'
        }`}
      />
    </button>
  );
}
