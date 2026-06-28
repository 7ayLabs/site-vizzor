'use client';

/**
 * DirectoryPicker — Claude-style "+" menu inside the chat composer.
 *
 * Opens a popover above the `+` button with three sections (Skills /
 * Connectors / Plugins). Each section lists entries from
 * `/api/directory/catalog`. Interactions:
 *
 *   - Skill: clicking activates it via PATCH /api/directory/skills/active
 *     (single-select — the previously-active skill is auto-cleared);
 *     clicking the active skill clears it.
 *   - Connector / Plugin: clicking unimported entries deep-links to
 *     /app/directory where the install sheet handles credentials.
 *     Clicking an installed entry is a no-op (state is already on).
 *
 * The user never leaves the chat for the common case (switching a
 * skill). Catalog state is mutated via SWR so the chip in the
 * composer and the directory page agree without a refresh.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowUpRight, Boxes, Check, Layers, Plug, Puzzle } from 'lucide-react';

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
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
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

  const entries = data?.entries ?? [];
  const sections = useMemo(
    () => ({
      skill: entries.filter((e) => e.category === 'skill'),
      connector: entries.filter((e) => e.category === 'connector'),
      plugin: entries.filter((e) => e.category === 'plugin'),
    }),
    [entries],
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
      // Keep open — user might want to swap quickly.
      return;
    }
    if (entry.installed) {
      // Already installed; nothing to do here. User can manage via
      // the directory page.
      window.location.href = `/${locale}/app/directory`;
      setOpen(false);
      return;
    }
    // Connector / plugin not installed yet — install needs credentials,
    // which live behind the directory's install sheet.
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
        <Boxes size={16} strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <div ref={wrapRef} className="relative shrink-0 self-end mb-px">
      <button
        ref={triggerRef}
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
        <Boxes size={16} strokeWidth={1.75} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('trigger')}
          className="absolute bottom-full left-0 mb-2 w-[280px] rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_30px_rgba(0,0,0,0.40)] overflow-hidden z-[60]"
        >
          <PickerSection
            title={t('section.skill')}
            icon={<Layers size={13} strokeWidth={1.75} />}
            entries={sections.skill}
            onSelect={onSelect}
            kind="skill"
          />
          <PickerSection
            title={t('section.connector')}
            icon={<Plug size={13} strokeWidth={1.75} />}
            entries={sections.connector}
            onSelect={onSelect}
            kind="connector"
          />
          <PickerSection
            title={t('section.plugin')}
            icon={<Puzzle size={13} strokeWidth={1.75} />}
            entries={sections.plugin}
            onSelect={onSelect}
            kind="plugin"
          />
          <a
            href={`/${locale}/app/directory`}
            className="flex items-center justify-between px-3 py-2 text-[12px] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] border-t border-[var(--border)] transition-colors"
            onClick={() => setOpen(false)}
          >
            <span>{t('manage')}</span>
            <ArrowUpRight size={12} className="text-[var(--fg-3)]" strokeWidth={1.75} />
          </a>
        </div>
      )}
    </div>
  );
}

function PickerSection({
  title,
  icon,
  entries,
  onSelect,
  kind,
}: {
  title: string;
  icon: React.ReactNode;
  entries: HydratedEntry[];
  onSelect: (entry: HydratedEntry) => void;
  kind: Category;
}) {
  const t = useTranslations('predict.shell.picker');
  if (entries.length === 0) return null;
  return (
    <div className="py-1.5 border-b border-[var(--border)] last:border-b-0">
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
        <span aria-hidden>{icon}</span>
        <span>{title}</span>
      </div>
      <ul className="px-1">
        {entries.map((entry) => {
          const active = entry.active_skill || (kind !== 'skill' && entry.installed);
          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => onSelect(entry)}
                role="menuitem"
                className={`group w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] text-left transition-colors ${
                  active
                    ? 'text-[var(--fg)]'
                    : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={entry.icon}
                  alt=""
                  className="w-4 h-4 rounded shrink-0 opacity-90"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
                <span className="flex-1 truncate">{entry.name}</span>
                {entry.locked && (
                  <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--fg-3)] border border-[var(--border)] rounded-sm px-1 py-0.5">
                    {entry.required_tier}
                  </span>
                )}
                {active && (
                  <Check
                    size={13}
                    className="text-[var(--accent)] shrink-0"
                    strokeWidth={2}
                  />
                )}
                {!active && kind === 'plugin' && (
                  <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
                    {t('reserved')}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
