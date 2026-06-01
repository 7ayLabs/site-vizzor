'use client';

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
        relative inline-flex h-9 w-9 items-center justify-center
        rounded-full border border-[var(--border)]
        bg-[var(--surface)] text-[var(--fg-2)]
        transition-[background,color,transform] duration-200
        hover:text-[var(--fg)] hover:bg-[var(--surface-2)]
        active:scale-[0.96]
      "
    >
      <Sun
        size={16}
        strokeWidth={1.75}
        className={`absolute transition-all duration-200 ${
          isDark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'
        }`}
      />
      <Moon
        size={16}
        strokeWidth={1.75}
        className={`absolute transition-all duration-200 ${
          isDark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0'
        }`}
      />
    </button>
  );
}
