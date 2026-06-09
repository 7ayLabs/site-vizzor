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
}

export function SlashPalette({ query, onPick, onClose }: SlashPaletteProps) {
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
        'absolute bottom-full left-0 right-0 mb-2',
        'rounded-2xl border border-[var(--border)] bg-[var(--surface)]',
        'shadow-[0_18px_44px_-22px_color-mix(in_oklab,var(--fg)_38%,transparent)]',
        'overflow-hidden',
      )}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-3',
          'border-b border-[var(--border)]',
          'px-4 py-2.5',
        )}
      >
        <span className="text-[11.5px] uppercase tracking-[0.16em] font-semibold text-[var(--fg-3)]">
          Engine commands
        </span>
        <span className="mono tabular text-[10px] text-[var(--fg-3)]">
          {filtered.length} of {ENGINE_SLASH_COMMANDS.length}
        </span>
      </div>

      <ul
        ref={listRef}
        className="max-h-[280px] overflow-y-auto py-1"
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
                'flex items-start gap-3 px-4 py-2.5 cursor-pointer',
                'transition-colors',
                active
                  ? 'bg-[color-mix(in_oklab,var(--fg)_7%,transparent)]'
                  : 'hover:bg-[var(--surface-2)]',
              )}
              onMouseEnter={() => setActiveIdx(idx)}
              onClick={() => onPick(c.command)}
            >
              <span
                className={cn(
                  'mono tabular text-[11.5px] uppercase tracking-[0.06em]',
                  'shrink-0 px-1.5 h-5 inline-flex items-center',
                  'rounded-md border border-[var(--border-hi)] bg-[var(--surface-2)]',
                  'text-[var(--fg)]',
                )}
              >
                {c.command}
              </span>
              <span className="min-w-0 flex-1 flex flex-col leading-tight">
                <span className="text-[12.5px] font-semibold text-[var(--fg)]">
                  {c.label}
                </span>
                <span className="text-[11px] text-[var(--fg-3)] line-clamp-1">
                  {c.body}
                </span>
              </span>
              <span className="hidden sm:flex flex-col items-end leading-tight shrink-0">
                <span className="mono tabular text-[10px] text-[var(--fg-3)]">
                  {GROUP_LABEL[c.group]}
                </span>
                <span className="mono tabular text-[10px] text-[var(--fg-2)] truncate max-w-[140px]">
                  {c.example}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <div
        className={cn(
          'flex items-center justify-between gap-3',
          'border-t border-[var(--border)]',
          'px-4 py-2',
          'mono tabular text-[10px] uppercase tracking-[0.14em] text-[var(--fg-3)]',
        )}
      >
        <span>↑ ↓ navigate · ↵ insert · esc dismiss</span>
        <span>{ENGINE_SLASH_COMMANDS.length} engine tools</span>
      </div>
    </div>
  );
}
