'use client';

/**
 * DirectoryPicker — Claude-style "+" menu inside the chat composer.
 *
 * Compact tabbed popover above the `+` button — one tab per category
 * (Skills / Connectors / Plugins). The previous stacked-sections
 * layout grew to 17 rows tall when every category was populated,
 * overshooting the composer area. Tabs keep the menu fixed-height:
 * at most 8 rows visible per tab, anything beyond scrolls inside a
 * 240px viewport.
 *
 * Interactions:
 *   - Skill: clicking activates via PATCH /api/directory/skills/active
 *     (single-select — the previously-active skill auto-clears);
 *     clicking the active skill clears it. Menu stays open so the
 *     user can swap quickly.
 *   - Connector / Plugin: not-yet-installed deep-links to
 *     /app/directory (install needs the credentials sheet); already-
 *     installed entries are a no-op + close.
 *   - Tier-locked: routes to /pricing for the upgrade story.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowUpRight, Check, Plus } from 'lucide-react';

type Category = 'skill' | 'connector' | 'plugin';

interface HydratedEntry {
  id: string;
  name: string;
  category: Category;
  icon: string;
  summary: string;
  installed: boolean;
  install_id: string | null;
  active_skill: boolean;
  locked: boolean;
  required_tier: 'free' | 'pro' | 'elite';
}

interface CatalogResponse {
  ok: boolean;
  caller_tier?: string | null;
  entries: HydratedEntry[];
}

const CATALOG_URL = '/api/directory/catalog';
const CATEGORIES: ReadonlyArray<Category> = ['skill', 'connector', 'plugin'];

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
  const wrapRef = useRef<HTMLDivElement | null>(null);
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

  const entries = useMemo(
    () =>
      (data?.entries ?? [])
        .filter((e) => e.category === tab)
        .sort((a, b) => {
          // Active skill first, installed second, alphabetical.
          if (a.active_skill !== b.active_skill) return a.active_skill ? -1 : 1;
          if (a.installed !== b.installed) return a.installed ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
    [data, tab],
  );

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
        aria-label={t('triggerDisabled')}
        className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--fg-3)] cursor-not-allowed self-end mb-px"
      >
        <Plus size={18} strokeWidth={2} />
      </button>
    );
  }

  return (
    <div ref={wrapRef} className="relative shrink-0 self-end mb-px">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
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
          className="absolute bottom-full left-0 mb-2 w-[284px] rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_30px_rgba(0,0,0,0.40)] overflow-hidden z-[60] flex flex-col motion-safe:animate-[vt-pick-pop_180ms_ease-out]"
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
            {/* Sliding underline — width = 1/3 of strip, translates by
                tab index. Eased so the eye tracks the move instead of
                seeing the underline jump between tabs. */}
            <span
              aria-hidden
              className="absolute -bottom-px h-px bg-[var(--fg)] transition-transform duration-200 ease-out"
              style={{
                width: 'calc((100% - 8px) / 3)',
                left: '4px',
                transform: `translateX(calc(${CATEGORIES.indexOf(tab)} * (100% + 0px)))`,
              }}
            />
          </div>

          {/* Scroll viewport — fixed max-height keeps the menu compact.
              key={tab} re-mounts the list, retriggering the fade-in
              animation so swapping tabs feels intentional. */}
          <div className="max-h-[300px] overflow-y-auto py-1.5">
            <div key={tab} className="motion-safe:animate-[vt-pick-in_180ms_ease-out]">
              {entries.length === 0 ? (
                <p className="px-3 py-3 text-[12px] text-[var(--fg-3)]">
                  {t(`empty.${tab}`)}
                </p>
              ) : (
                <ul className="px-1">
                  {entries.map((entry) => (
                    <li key={entry.id}>
                      <Row entry={entry} onSelect={onSelect} tab={tab} />
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
  tab,
}: {
  entry: HydratedEntry;
  onSelect: (entry: HydratedEntry) => void;
  tab: Category;
}) {
  const t = useTranslations('predict.shell.picker');
  const active = entry.active_skill || (tab !== 'skill' && entry.installed);
  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      role="menuitem"
      className={`group w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] text-left transition-colors duration-150 ${
        active
          ? 'text-[var(--fg)]'
          : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]'
      }`}
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
      ) : tab === 'plugin' ? (
        <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--fg-3)] shrink-0">
          {t('reserved')}
        </span>
      ) : null}
    </button>
  );
}
