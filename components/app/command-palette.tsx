'use client';

/**
 * CommandPalette — full-screen Cmd+K modal.
 *
 * Pattern forked from `components/predict/slash-palette.tsx` (filter +
 * keyboard nav + active-row scroll). Differences:
 *   - Portal-mounted overlay rather than absolute-positioned popover.
 *   - Global Cmd+K listener (gated against text-input focus so the
 *     in-composer typing experience isn't hijacked).
 *   - Catalog-driven (`buildCommandCatalog()`) instead of hard-coded.
 *
 * Security: destructive commands (`danger: true`) are not invoked on
 * single-Enter — the palette renders a "Press Enter again to confirm"
 * row before calling `run`. Keeps the palette useful for sign-out /
 * delete-thread without making them one-keypress mistakes.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import {
  buildCommandCatalog,
  filterCommands,
  groupLabelFor,
  type Command,
  type CommandContext,
} from './command-catalog';
import { useCommandPalette } from './command-palette-context';
import { useTour } from '@/components/onboarding/tour-provider';

export function CommandPalette() {
  const t = useTranslations('app.commandPalette');
  const { open, setOpen } = useCommandPalette();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Global Cmd+K toggle. Gated so the in-composer Cmd+K (which focuses
  // the textarea) doesn't conflict — when the user is typing in a
  // textarea or contenteditable, we let the existing behavior win.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== 'k') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase() ?? '';
      const isEditable =
        tag === 'textarea' ||
        tag === 'input' ||
        target?.isContentEditable === true;
      if (isEditable && !open) return;
      e.preventDefault();
      setOpen(!open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Reset transient state when the palette closes.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIdx(0);
      setConfirmIdx(null);
      return;
    }
    // Focus the input on next paint so the modal can show first.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const catalog = useMemo(buildCommandCatalog, []);
  const filtered = useMemo(() => filterCommands(query, catalog), [query, catalog]);

  // Re-clamp active index when the filtered list shrinks.
  useEffect(() => {
    if (activeIdx >= filtered.length) {
      setActiveIdx(filtered.length === 0 ? 0 : filtered.length - 1);
    }
  }, [activeIdx, filtered.length]);

  const tour = useTour();
  const navigateCtx: CommandContext = useMemo(
    () => ({
      navigate: (href) => {
        // next-intl router accepts both typed routes and string fall-
        // throughs; the catalog uses simple route strings so we cast.
        router.push(href as never);
      },
      tour: { open: tour.open },
    }),
    [router, tour],
  );

  function runCommand(cmd: Command, idx: number): void {
    if (cmd.danger && confirmIdx !== idx) {
      setConfirmIdx(idx);
      return;
    }
    setOpen(false);
    cmd.run(navigateCtx);
  }

  // Keyboard navigation while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (filtered.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
        setConfirmIdx(null);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
        setConfirmIdx(null);
      } else if (e.key === 'Enter') {
        const cmd = filtered[activeIdx];
        if (cmd) {
          e.preventDefault();
          runCommand(cmd, activeIdx);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filtered, activeIdx, confirmIdx]);

  // Scroll the active row into view as the user navigates.
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLLIElement>(`[data-idx="${activeIdx}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('label')}
      className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[18vh]"
    >
      {/* Backdrop — click to dismiss. */}
      <button
        type="button"
        aria-label={t('dismiss')}
        onClick={() => setOpen(false)}
        className="
          absolute inset-0
          bg-[color:color-mix(in_oklab,var(--bg)_70%,black_20%)]/85
          backdrop-blur-[6px]
        "
      />

      {/* Panel */}
      <div
        className="
          relative z-10 w-full max-w-[640px]
          border border-[var(--border)] bg-[var(--surface)]
          rounded-2xl shadow-[0_20px_60px_-24px_rgba(0,0,0,0.55)]
          overflow-hidden
          motion-safe:slash-palette-slide-in
        "
      >
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
              setConfirmIdx(null);
            }}
            placeholder={t('placeholder')}
            className="
              flex-1 bg-transparent outline-none
              text-[14px] text-[var(--fg)] placeholder:text-[var(--fg-3)]
            "
            autoComplete="off"
            spellCheck={false}
          />
          <span className="mono tabular text-[10px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
            {filtered.length}/{catalog.length}
          </span>
        </div>

        <ul
          ref={listRef}
          className="max-h-[55vh] overflow-y-auto py-1.5"
        >
          {filtered.length === 0 && (
            <li className="px-4 py-3 text-[12.5px] text-[var(--fg-3)]">
              {t('empty')}
            </li>
          )}
          {filtered.map((cmd, idx) => {
            const active = idx === activeIdx;
            const confirming = confirmIdx === idx && cmd.danger;
            return (
              <li
                key={cmd.id}
                data-idx={idx}
                onMouseEnter={() => {
                  setActiveIdx(idx);
                  setConfirmIdx(null);
                }}
                onClick={() => runCommand(cmd, idx)}
                className={`
                  relative flex items-center gap-3 cursor-pointer
                  px-4 py-2.5
                  transition-colors
                  ${
                    active
                      ? 'bg-[color-mix(in_oklab,var(--fg)_4%,transparent)]'
                      : 'hover:bg-[color-mix(in_oklab,var(--fg)_3%,transparent)]'
                  }
                `}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r-full bg-[var(--fg)]"
                  />
                )}
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-[13px] font-medium text-[var(--fg)]">
                    {cmd.label}
                    {cmd.danger && (
                      <span className="ml-2 mono tabular text-[9.5px] uppercase tracking-[0.14em] text-rose-500">
                        danger
                      </span>
                    )}
                  </span>
                  {cmd.hint && (
                    <span className="text-[11px] text-[var(--fg-3)] line-clamp-1">
                      {confirming ? t('confirmHint') : cmd.hint}
                    </span>
                  )}
                </div>
                <span className="hidden sm:inline-flex mono tabular text-[10px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
                  {groupLabelFor(cmd.group)}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="px-4 py-2 border-t border-[var(--border)] mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--fg-3)] flex items-center justify-between gap-3">
          <span>{t('footer.navigate')}</span>
          <span>{t('footer.dismiss')}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
