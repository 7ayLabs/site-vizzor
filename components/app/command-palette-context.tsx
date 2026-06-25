'use client';

/**
 * CommandPaletteProvider — single source of truth for whether the
 * Cmd+K palette is open.
 *
 * Why a dedicated context rather than folding into AppShellProvider:
 *   1. AppShellProvider runs SWR + wallet adapter — re-rendering its
 *      consumers on every palette open/close would invalidate caches
 *      unnecessarily.
 *   2. The palette can later be triggered from places that don't sit
 *      under AppShellProvider (e.g. onboarding step inviting the user
 *      to discover Cmd+K). A separate, smaller context keeps that
 *      flexibility cheap.
 */

import { createContext, useContext, useState, type ReactNode } from 'react';

export interface CommandPaletteState {
  open: boolean;
  setOpen: (next: boolean) => void;
  toggle: () => void;
}

const Ctx = createContext<CommandPaletteState | null>(null);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Ctx.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCommandPalette(): CommandPaletteState {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useCommandPalette must be used within <CommandPaletteProvider>');
  }
  return ctx;
}
