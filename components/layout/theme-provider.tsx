'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
type Resolved = Theme;

interface ThemeContextValue {
  theme: Theme | 'system';
  resolved: Resolved;
  setTheme: (next: Theme | 'system') => void;
  toggle: () => void;
  /**
   * Cycle through the three modes: light → dark → system → light. The
   * 'system' stop lets users on mobile (or anywhere) opt back into
   * following the OS preference after they've manually switched.
   * Without it, a single tap on the toggle would lock the theme
   * forever — system-follow becomes a one-way door.
   */
  cycle: () => void;
}

const STORAGE_KEY = 'vizzor-theme';
const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): Theme | 'system' {
  if (typeof window === 'undefined') return 'system';
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === 'light' || v === 'dark') return v;
  return 'system';
}

function systemPref(): Resolved {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolved: Resolved) {
  const html = document.documentElement;
  html.setAttribute('data-theme', resolved);
  // Fumadocs (and other libs that follow the Tailwind/shadcn convention)
  // gate dark mode on the `.dark` class. We toggle both so internals
  // and our token CSS vars stay in sync.
  html.classList.toggle('dark', resolved === 'dark');
  html.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme | 'system'>('system');
  const [resolved, setResolved] = useState<Resolved>('light');

  // First mount — read stored pref, compute resolved, apply.
  useEffect(() => {
    const stored = readStored();
    const next: Resolved = stored === 'system' ? systemPref() : stored;
    setThemeState(stored);
    setResolved(next);
    applyTheme(next);
  }, []);

  // Listen to system change if user is on 'system'.
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const next: Resolved = mq.matches ? 'dark' : 'light';
      setResolved(next);
      applyTheme(next);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme | 'system') => {
    setThemeState(next);
    if (next === 'system') {
      window.localStorage.removeItem(STORAGE_KEY);
      const r = systemPref();
      setResolved(r);
      applyTheme(r);
    } else {
      window.localStorage.setItem(STORAGE_KEY, next);
      setResolved(next);
      applyTheme(next);
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setTheme]);

  const cycle = useCallback(() => {
    // light → dark → system → light. The order keeps the binary
    // light/dark flip on the first tap (matching every other site)
    // and surfaces 'system' on the third tap as the explicit
    // "follow my OS" stop.
    const next: Theme | 'system' =
      theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    setTheme(next);
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme, toggle, cycle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}

/**
 * Inline script that runs BEFORE React hydrates so the correct theme is set
 * with no flash of wrong mode. Returned as a string for use with `dangerouslySetInnerHTML`.
 */
export const themeBootScript = `
(function(){
  try {
    var key='${STORAGE_KEY}';
    var stored=localStorage.getItem(key);
    var sys=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
    var t=(stored==='light'||stored==='dark')?stored:sys;
    var d=document.documentElement;
    d.setAttribute('data-theme',t);
    if(t==='dark'){d.classList.add('dark');}else{d.classList.remove('dark');}
    d.style.colorScheme=t;
  } catch(e){}
})();
`.trim();
