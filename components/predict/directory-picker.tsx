'use client';

/**
 * DirectoryPicker — Claude-style "+" menu inside the chat composer.
 *
 * Compact tabbed popover above the `+` button — one tab per category
 * (Skills / Connectors). The picker is a "favorites only" surface: it
 * shows just the items the user has pinned. The full catalog (and the
 * pin/unpin affordances for items not yet pinned) lives on
 * /app/directory. When a tab has zero pins, the empty state links
 * straight to that page so users can fill the favorites set.
 *
 * Interactions:
 *   - Skill: clicking activates via PATCH /api/directory/skills/active
 *     (single-select — the previously-active skill auto-clears);
 *     clicking the active skill clears it. The trailing pin button
 *     fires PATCH /api/directory/pinned to unpin (removes the row from
 *     the picker; the item stays in the full Directory). Menu stays
 *     open so the user can swap quickly.
 *   - Connector: not-yet-installed deep-links to /app/directory
 *     (install needs the credentials sheet); already-installed entries
 *     are a no-op + close. Pin button works the same as on skills.
 *   - Tier-locked: routes to /pricing for the upgrade story.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowUpRight, Check, Pin, Plus, Search } from 'lucide-react';

type Category = 'skill' | 'connector';

interface HydratedEntry {
  id: string;
  name: string;
  summary: string;
  category: Category;
  icon: string;
  installed: boolean;
  install_id: string | null;
  active_skill: boolean;
  pinned: boolean;
  locked: boolean;
  required_tier: 'free' | 'pro' | 'elite';
}

interface CatalogResponse {
  ok: boolean;
  caller_tier?: string | null;
  entries: HydratedEntry[];
}

const CATALOG_URL = '/api/directory/catalog';
const CATEGORIES: ReadonlyArray<Category> = ['skill', 'connector'];

const catalogFetcher = (url: string): Promise<CatalogResponse> =>
  fetch(url, { credentials: 'same-origin' }).then((r) =>
    r.ok ? (r.json() as Promise<CatalogResponse>) : { ok: false, entries: [] },
  );

interface Props {
  signedIn: boolean;
  disabled?: boolean;
}

export function DirectoryPicker({ signedIn, disabled = false }: Props) {
  const t = useTranslations('predict.shell.picker');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Category>('skill');
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const { mutate } = useSWRConfig();

  const { data } = useSWR<CatalogResponse>(
    signedIn ? CATALOG_URL : null,
    catalogFetcher,
    { revalidateOnFocus: true },
  );

  // Close on outside click or Esc.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Reset the search when switching tabs — keeps the affordance honest
  // (a query from Skills shouldn't silently filter Connectors).
  useEffect(() => {
    setQuery('');
  }, [tab]);

  // Auto-focus the search input when the menu opens so the user can
  // start typing immediately. requestAnimationFrame so the input has
  // mounted by the time focus is requested.
  useEffect(() => {
    if (!open) return;
    const handle = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(handle);
  }, [open, tab]);

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.entries ?? [])
      .filter((e) => e.category === tab)
      // Favorites-only — full catalog lives on /app/directory.
      .filter((e) => e.pinned)
      .filter((e) => {
        if (!q) return true;
        return (
          e.name.toLowerCase().includes(q) ||
          e.summary.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        // Active skill floats above other pins, then installed
        // connectors, then alphabetical inside the favorites set.
        if (a.active_skill !== b.active_skill) return a.active_skill ? -1 : 1;
        if (a.installed !== b.installed) return a.installed ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [data, tab, query]);

  async function activateSkill(entry: HydratedEntry) {
    const nextId = entry.active_skill ? null : entry.id;
    await fetch('/api/directory/skills/active', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skill_id: nextId }),
    });
    mutate(CATALOG_URL);
    mutate('/api/directory/skills/active');
  }

  async function togglePin(entry: HydratedEntry) {
    const next = !entry.pinned;
    // Optimistic update so the row disappears from the picker before
    // the round-trip lands (and reappears on a failure → revalidate).
    mutate(
      CATALOG_URL,
      (prev: CatalogResponse | undefined) =>
        prev
          ? {
              ...prev,
              entries: prev.entries.map((e) =>
                e.id === entry.id ? { ...e, pinned: next } : e,
              ),
            }
          : prev,
      { revalidate: false },
    );
    try {
      await fetch('/api/directory/pinned', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ item_id: entry.id, pinned: next }),
      });
    } finally {
      mutate(CATALOG_URL);
    }
  }

  function onSelect(entry: HydratedEntry) {
    if (entry.locked) {
      window.location.href = `/${locale}/pricing`;
      setOpen(false);
      return;
    }
    if (entry.category === 'skill') {
      void activateSkill(entry);
      return; // keep open
    }
    window.location.href = `/${locale}/app/directory`;
    setOpen(false);
  }

  if (!signedIn) {
    return (
      <button
        type="button"
        disabled
        data-tour-id="composer-topics"
        aria-label={t('triggerDisabled')}
        className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--fg-3)] cursor-not-allowed self-end mb-px"
      >
        <Plus size={18} strokeWidth={2} />
      </button>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="relative shrink-0 self-end mb-px"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        data-tour-id="composer-topics"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('trigger')}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
          open
            ? 'bg-[var(--surface-2)] text-[var(--fg)]'
            : 'text-[var(--fg-3)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]'
        } disabled:opacity-50`}
      >
        <Plus size={18} strokeWidth={2} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('trigger')}
          className="absolute bottom-full left-0 mb-2 w-[300px] rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_30px_rgba(0,0,0,0.40)] overflow-hidden z-[60] flex flex-col motion-safe:animate-[vt-pick-pop_180ms_ease-out]"
        >
          {/* Local keyframes — the rest of the file is Tailwind only.
              vt-pick-pop:  the whole menu slides up + fades in on open.
              vt-pick-in:   the content swap when the active tab changes.
              Keys are namespaced (vt-pick-*) so they don't collide
              with other components' animations. */}
          <style>{`
            @keyframes vt-pick-pop {
              from { opacity: 0; transform: translateY(6px) scale(0.985); }
              to   { opacity: 1; transform: translateY(0) scale(1); }
            }
            @keyframes vt-pick-in {
              from { opacity: 0; transform: translateY(3px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>

          {/* Tab strip — 36px tall, animated underline that slides
              between tabs instead of popping per tab. */}
          <div className="relative flex border-b border-[var(--border)] px-1 pt-1">
            {CATEGORIES.map((key) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex-1 px-2 pt-2 pb-2.5 text-[12px] transition-colors duration-150 ${
                    active
                      ? 'text-[var(--fg)] font-medium'
                      : 'text-[var(--fg-3)] hover:text-[var(--fg-2)]'
                  }`}
                >
                  {t(`section.${key}`)}
                </button>
              );
            })}
            {/* Sliding underline — width = 1/2 of strip, translates by
                tab index. Eased so the eye tracks the move instead of
                seeing the underline jump between tabs. */}
            <span
              aria-hidden
              className="absolute -bottom-px h-px bg-[var(--fg)] transition-transform duration-200 ease-out"
              style={{
                width: 'calc((100% - 8px) / 2)',
                left: '4px',
                transform: `translateX(calc(${CATEGORIES.indexOf(tab)} * 100%))`,
              }}
            />
          </div>

          {/* Search input — same chrome as the full Directory shell so
              the picker reads as the inline twin of that surface. */}
          <div className="px-2 pt-2 pb-1.5">
            <label className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 focus-within:border-[var(--fg-3)] transition-colors">
              <Search
                size={12}
                strokeWidth={1.75}
                className="text-[var(--fg-3)] shrink-0"
                aria-hidden
              />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('search.placeholder')}
                aria-label={t('search.placeholder')}
                className="flex-1 min-w-0 bg-transparent text-[12px] text-[var(--fg)] outline-none placeholder:text-[var(--fg-3)]"
              />
            </label>
          </div>

          {/* Scroll viewport — fixed max-height keeps the menu compact.
              key={tab + query.length flag} re-mounts the list on tab
              swap so the fade-in animation retriggers; query changes
              don't trigger it (would feel jittery). */}
          <div className="max-h-[280px] overflow-y-auto pb-1.5">
            <div key={tab} className="motion-safe:animate-[vt-pick-in_180ms_ease-out]">
              {entries.length === 0 ? (
                query.trim() ? (
                  <p className="px-3 py-3 text-[12px] text-[var(--fg-3)]">
                    {t('empty.noResults')}
                  </p>
                ) : (
                  <a
                    href={`/${locale}/app/directory`}
                    onClick={() => setOpen(false)}
                    className="mx-2 my-2 flex flex-col items-start gap-1 rounded-md border border-dashed border-[var(--border)] px-3 py-3 text-[12px] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors"
                  >
                    <span>{t(`empty.${tab}`)}</span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-[var(--fg-3)]">
                      {t('empty.cta')}
                      <ArrowUpRight size={11} strokeWidth={1.75} aria-hidden />
                    </span>
                  </a>
                )
              ) : (
                <ul className="px-1">
                  {entries.map((entry) => (
                    <li key={entry.id}>
                      <Row
                        entry={entry}
                        onSelect={onSelect}
                        onTogglePin={togglePin}
                        tab={tab}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Footer */}
          <a
            href={`/${locale}/app/directory`}
            className="flex items-center justify-between px-3 py-2 text-[12px] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] border-t border-[var(--border)] transition-colors"
            onClick={() => setOpen(false)}
          >
            <span>{t('manage')}</span>
            <ArrowUpRight
              size={12}
              className="text-[var(--fg-3)]"
              strokeWidth={1.75}
            />
          </a>
        </div>
      )}
    </div>
  );
}

function Row({
  entry,
  onSelect,
  onTogglePin,
  tab,
}: {
  entry: HydratedEntry;
  onSelect: (entry: HydratedEntry) => void;
  onTogglePin: (entry: HydratedEntry) => void;
  tab: Category;
}) {
  const t = useTranslations('predict.shell.picker');
  const active = entry.active_skill || (tab !== 'skill' && entry.installed);
  return (
    <div
      className={`group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] transition-colors duration-150 ${
        active
          ? 'text-[var(--fg)]'
          : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(entry)}
        role="menuitem"
        className="flex flex-1 min-w-0 items-center gap-2.5 text-left"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={entry.icon}
          alt=""
          className="w-5 h-5 rounded shrink-0 opacity-95 transition-transform duration-150 group-hover:scale-[1.04]"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
        <span className="flex-1 truncate leading-[1.35]">{entry.name}</span>
        {entry.locked ? (
          <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--fg-3)] border border-[var(--border)] rounded-sm px-1 py-px shrink-0">
            {entry.required_tier}
          </span>
        ) : active ? (
          <Check
            size={13}
            className="text-[var(--accent)] shrink-0"
            strokeWidth={2.5}
          />
        ) : null}
      </button>
      {/* Every row in this menu is already pinned (filter upstream) —
          the trailing pin button is the unpin affordance. Visible on
          hover so the row reads as "your favorite" by default and the
          unpin tool only appears when the user reaches for it. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin(entry);
        }}
        aria-label={t('unpin')}
        aria-pressed
        className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--accent)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
      >
        <Pin size={12} strokeWidth={2.25} className="fill-current" />
      </button>
    </div>
  );
}
