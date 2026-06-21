'use client';

/**
 * SlashPalette — the floating command palette the composer pops open
 * when the user types `/` (or focuses Cmd+K).
 *
 * The catalog is sourced from `ENGINE_SLASH_COMMANDS` in
 * `./crypto-widgets.tsx`, which mirrors the canonical tool registry
 * inside the vizzor backend (`src/ai/tools.ts`). When the engine grows
 * a new tool, add a single entry there — both the palette and the
 * left-rail tools surface pick it up.
 *
 * Keyboard semantics:
 *   - ↑ / ↓        navigate filtered results
 *   - Enter        insert the selected command into the composer
 *   - Escape       close
 *   - Filter is a prefix match on the command + a substring match on
 *     the label so users discover commands either way.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  ENGINE_SLASH_COMMANDS,
  type SlashCommandSpec,
} from './crypto-widgets';

const GROUP_LABEL: Record<SlashCommandSpec['group'], string> = {
  predict: 'Predict',
  data: 'Market data',
  forensics: 'Forensics',
  macro: 'Macro',
  meta: 'Meta',
};

export interface SlashPaletteProps {
  query: string;
  onPick: (command: string) => void;
  onClose: () => void;
  /**
   * When true, the panel is on its way out — render the
   * exit-animation class so the dismiss reads as decisive instead of
   * snapping to unmount. Consumers that don't need an exit transition
   * (the in-composer `/` palette, which is gated by the textarea
   * content and unmounts instantly) can leave this undefined.
   */
  exiting?: boolean;
  /**
   * `true` (default) — anchor above the parent via `absolute bottom-full`;
   * matches the in-composer surface where the palette floats above the
   * textarea.
   * `false` — render inline so the parent owns the layout; used by the
   * standalone Tools modal overlay, which centers the palette inside a
   * full-viewport dialog and wants the whole list visible without
   * clipping.
   */
  floating?: boolean;
}

export function SlashPalette({
  query,
  onPick,
  onClose,
  exiting = false,
  floating = true,
}: SlashPaletteProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  const trimmed = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (trimmed.length <= 1) return ENGINE_SLASH_COMMANDS;
    const needle = trimmed.replace(/^\//, '');
    return ENGINE_SLASH_COMMANDS.filter((c) => {
      if (c.command.toLowerCase().startsWith(`/${needle}`)) return true;
      if (c.label.toLowerCase().includes(needle)) return true;
      return false;
    });
  }, [trimmed]);

  // Re-clamp the active index when the filtered list shrinks.
  useEffect(() => {
    if (activeIdx >= filtered.length) {
      setActiveIdx(filtered.length === 0 ? 0 : filtered.length - 1);
    }
  }, [activeIdx, filtered.length]);

  // Keyboard nav. We listen on the window so the composer's textarea
  // (which has focus) can pass through arrow keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (filtered.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        // ⌘/Ctrl + Enter is the power-user submit shortcut — let it
        // fall through to the textarea form handler instead of
        // inserting the focused slash row.
        if (e.metaKey || e.ctrlKey) return;
        const picked = filtered[activeIdx];
        if (picked) {
          e.preventDefault();
          onPick(picked.command);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [activeIdx, filtered, onClose, onPick]);

  // Scroll the active row into view as the user navigates.
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLLIElement>(
      `[data-idx="${activeIdx}"]`,
    );
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  return (
    <div
      role="listbox"
      aria-label="Slash command palette"
      className={cn(
        // Positioning. When `floating`, the palette anchors above the
        // parent composer via `absolute bottom-full`; when inline (the
        // standalone Tools modal overlay), the parent owns the layout
        // and the palette renders in normal flow so the whole list is
        // visible without clipping.
        floating && 'absolute bottom-full left-0 right-0 mb-2',
        // Solid minimalist surface — Claude / ChatGPT command-palette
        // aesthetic. The chips bar sits directly behind this popover so
        // a transparent surface bleeds the chip text through and reads
        // as broken. A fully opaque elevated tone keeps the row legible
        // and the visual hierarchy clear.
        'rounded-2xl border border-[var(--border)]',
        'bg-[var(--surface)]',
        'shadow-[0_12px_36px_-18px_color-mix(in_oklab,#000_85%,transparent)]',
        'overflow-hidden',
        'motion-safe:will-change-transform',
        // Enter / exit animation. The `motion-safe:` prefix lets the
        // prefers-reduced-motion media query collapse the duration to
        // ~0ms (defined globally in app/globals.css).
        exiting
          ? 'motion-safe:slash-palette-slide-out'
          : 'motion-safe:slash-palette-slide-in',
      )}
    >
      {/* Section stamp — borderless, sits flush above the list. The
          count moved into the footer so the header carries just a
          single light label. */}
      <div className="px-4 pt-3 pb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[10px] uppercase tracking-[0.2em] font-semibold text-[var(--fg-3)]">
          Engine commands
        </span>
        <span className="mono tabular text-[10px] text-[var(--fg-3)]">
          {filtered.length}/{ENGINE_SLASH_COMMANDS.length}
        </span>
      </div>

      <ul
        ref={listRef}
        className="max-h-[280px] overflow-y-auto pb-1"
      >
        {filtered.length === 0 && (
          <li className="px-4 py-3 text-[12.5px] text-[var(--fg-3)]">
            No engine command matches that prefix.
          </li>
        )}
        {filtered.map((c, idx) => {
          const active = idx === activeIdx;
          return (
            <li
              key={c.command}
              data-idx={idx}
              role="option"
              aria-selected={active}
              className={cn(
                'relative flex items-center gap-3 cursor-pointer',
                'px-4 py-2',
                'transition-colors',
                // Left-edge accent for the active row — a 2px hairline
                // pinned to the inset, no background flood. Reads as a
                // crisp focus cue rather than a heavy tint.
                'before:absolute before:left-0 before:top-1.5 before:bottom-1.5',
                'before:w-[2px] before:rounded-r-full',
                'before:transition-colors',
                active
                  ? 'bg-[color-mix(in_oklab,var(--fg)_4%,transparent)] before:bg-[var(--fg)]'
                  : 'before:bg-transparent hover:bg-[color-mix(in_oklab,var(--fg)_3%,transparent)]',
              )}
              onMouseEnter={() => setActiveIdx(idx)}
              onClick={() => onPick(c.command)}
            >
              {/* Command badge — lighter chrome, mono lowercase reads
                  closer to how the user actually types it. */}
              <span
                className={cn(
                  'mono tabular text-[11px] tracking-[0.02em]',
                  'shrink-0 px-1.5 h-[18px] inline-flex items-center',
                  'rounded-md border border-[var(--border)]',
                  active ? 'text-[var(--fg)]' : 'text-[var(--fg-2)]',
                )}
              >
                {c.command}
              </span>
              <span className="min-w-0 flex-1 flex flex-col leading-tight gap-0.5">
                <span className="text-[12.5px] font-medium text-[var(--fg)]">
                  {c.label}
                </span>
                <span className="text-[11px] text-[var(--fg-3)] line-clamp-1">
                  {c.body}
                </span>
              </span>
              {/* Group label only — drop the duplicate example. The
                  badge already shows the command verbatim, and the
                  example just doubled the noise. */}
              <span className="hidden sm:inline-flex shrink-0 mono tabular text-[10px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
                {GROUP_LABEL[c.group]}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Footer — borderless, just a sub-row of kbd hints in mono. The
          divider was redundant noise; whitespace separates it cleanly. */}
      <div className="px-4 pt-1 pb-2.5 mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
        <span>↑↓ navigate · ↵ insert · esc dismiss</span>
      </div>
    </div>
  );
}
