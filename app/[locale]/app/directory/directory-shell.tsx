'use client';

/**
 * DirectoryShell — `/app/directory` client island.
 *
 * Three tabs (Skills / Connectors / Plugins) over a category-aware card
 * grid. Each category has a different install/activate contract, and
 * the UI reflects that instead of forcing every entry through a generic
 * "+" button:
 *
 *   - Skills are single-select. Clicking activates one and deactivates
 *     any other — the catalog's `active_skill` flag drives a teal ring
 *     and the action button toggles between "Set as active" and
 *     "● Active". Activation is a `PATCH /api/directory/skills/active`,
 *     no install flow.
 *
 *   - Connectors are multi-install. `Install` opens the side sheet with
 *     a URL field; once installed, the card swaps to `Installed` +
 *     `Remove`. Telegram is special — it has its own pair flow, so the
 *     card links to `/account#integrations` with copy that says "Pair"
 *     / "Paired", not "Install" / "Installed".
 *
 *   - Plugins are multi-install too, but the engine's signal gatherers
 *     don't read the plugin registry yet (see runbook). To avoid
 *     telling users their predictions are influenced when they're not,
 *     plugin cards carry a `Reserved` badge and the install sheet
 *     surfaces a notice. The install flow still runs end-to-end so
 *     credentials are encrypted and ready when the engine catches up.
 *
 * SWR-fetches `/api/directory/catalog`; the cache is mutated after
 * every state change so the card flips without a page reload.
 */

import { useMemo, useState, useTransition } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { InstallSheet, type InstallTarget } from './install-sheet';

type Category = 'skill' | 'connector' | 'plugin';

interface ConfigField {
  name: string;
  label: string;
  placeholder?: string;
  kind: 'url' | 'secret' | 'text';
  pattern?: string;
  required: boolean;
}

interface ConfigSchema {
  fields: ConfigField[];
}

interface HydratedEntry {
  id: string;
  name: string;
  category: Category;
  icon: string;
  summary: string;
  partner_tier: 'vizzor' | 'partner' | 'community';
  install_kind: 'internal' | 'webhook' | 'apikey' | 'skill';
  status_text?: string;
  config_schema: ConfigSchema | null;
  external_docs?: string;
  installed: boolean;
  install_id: string | null;
  active_skill: boolean;
}

interface CatalogResponse {
  ok: boolean;
  entries: HydratedEntry[];
}

const CATALOG_URL = '/api/directory/catalog';
const CATEGORIES: ReadonlyArray<Category> = ['skill', 'connector', 'plugin'];

const fetcher = async (url: string): Promise<CatalogResponse> => {
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<CatalogResponse>;
};

export function DirectoryShell() {
  const t = useTranslations('app.directory');
  const [tab, setTab] = useState<Category>('skill');
  const [query, setQuery] = useState('');
  const [installTarget, setInstallTarget] = useState<InstallTarget | null>(null);
  const [, startTransition] = useTransition();
  const { mutate } = useSWRConfig();
  const { data, isLoading } = useSWR(CATALOG_URL, fetcher, {
    revalidateOnFocus: true,
  });

  const entries = data?.entries ?? [];

  // Sort: active skill first, then installed, then alphabetical. Drops
  // the popular_rank vanity — the user cares which one is doing
  // something for them right now, not what marketing thinks is hot.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => e.category === tab)
      .filter((e) => {
        if (!q) return true;
        return (
          e.name.toLowerCase().includes(q) ||
          e.summary.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (a.active_skill !== b.active_skill) return a.active_skill ? -1 : 1;
        if (a.installed !== b.installed) return a.installed ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [entries, tab, query]);

  async function setActiveSkill(skillId: string | null) {
    await fetch('/api/directory/skills/active', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skill_id: skillId }),
    });
    mutate(CATALOG_URL);
  }

  async function uninstall(installId: string) {
    await fetch(`/api/directory/install/${installId}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    mutate(CATALOG_URL);
  }

  function onAction(entry: HydratedEntry) {
    if (entry.category === 'skill') {
      // Single-select toggle. Tapping the active skill clears it; the
      // engine then falls back to default reasoning on the next predict.
      startTransition(() => {
        void setActiveSkill(entry.active_skill ? null : entry.id);
      });
      return;
    }
    if (entry.install_kind === 'internal') {
      const locale =
        typeof window !== 'undefined'
          ? window.location.pathname.split('/')[1] || 'en'
          : 'en';
      window.location.href = `/${locale}/account#integrations`;
      return;
    }
    setInstallTarget({
      connectorId: entry.id,
      name: entry.name,
      category: entry.category,
      schema: entry.config_schema,
    });
  }

  return (
    <>
      {/* Tab strip — horizontal, underlined. */}
      <div className="border-b border-[var(--border)] mb-6">
        <nav className="flex gap-6" aria-label={t('nav.label')}>
          {CATEGORIES.map((key) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-current={active ? 'page' : undefined}
                className={`relative px-1 pb-3 text-[13px] transition-colors ${
                  active
                    ? 'text-[var(--fg)] font-medium'
                    : 'text-[var(--fg-3)] hover:text-[var(--fg-2)]'
                }`}
              >
                {t(`tabs.${key}`)}
                {active && (
                  <span className="absolute left-0 right-0 -bottom-px h-px bg-[var(--fg)]" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* One-line category description + search. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <p className="text-[13px] text-[var(--fg-2)] leading-relaxed flex-1">
          {t(`category.${tab}.summary`)}
        </p>
        <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 w-full sm:w-[240px] shrink-0 focus-within:border-[var(--fg-3)]">
          <Search size={13} className="text-[var(--fg-3)] shrink-0" strokeWidth={1.75} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            className="flex-1 bg-transparent text-[12px] text-[var(--fg)] outline-none placeholder:text-[var(--fg-3)]"
          />
        </label>
      </div>

      {isLoading ? (
        <p className="text-[13px] text-[var(--fg-3)]">{t('loading')}</p>
      ) : filtered.length === 0 ? (
        <p className="text-[13px] text-[var(--fg-3)]">{t(`empty.${tab}`)}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              onAction={() => onAction(entry)}
              onUninstall={() =>
                entry.install_id && void uninstall(entry.install_id)
              }
            />
          ))}
        </div>
      )}

      <InstallSheet
        target={installTarget}
        onClose={() => setInstallTarget(null)}
        onInstalled={() => {
          setInstallTarget(null);
          mutate(CATALOG_URL);
        }}
      />
    </>
  );
}

interface CardProps {
  entry: HydratedEntry;
  onAction: () => void;
  onUninstall: () => void;
}

function EntryCard({ entry, onAction, onUninstall }: CardProps) {
  const t = useTranslations('app.directory');

  // Active skills get the only visible accent — a teal hairline ring.
  // Everything else stays neutral so the eye lands on whichever skill
  // is currently shaping reasoning.
  const ringClass = entry.active_skill
    ? 'border-[var(--accent)] shadow-[inset_0_0_0_1px_var(--accent)]'
    : 'border-[var(--border)]';

  return (
    <article
      className={`flex flex-col gap-3 rounded-xl border bg-[var(--surface)] p-4 transition-colors ${ringClass}`}
    >
      <header className="flex items-start gap-3">
        <EntryIcon icon={entry.icon} name={entry.name} />
        <div className="flex-1 min-w-0">
          <h3 className="text-[13.5px] font-semibold text-[var(--fg)] truncate leading-tight">
            {entry.name}
          </h3>
          {entry.category === 'plugin' && (
            <span className="inline-block mt-1 text-[9.5px] uppercase tracking-[0.14em] text-[var(--fg-3)] border border-[var(--border)] rounded-sm px-1.5 py-0.5">
              {t('badge.reserved')}
            </span>
          )}
        </div>
      </header>
      <p className="text-[12.5px] leading-snug text-[var(--fg-2)] line-clamp-2">
        {entry.summary}
      </p>
      <EntryAction entry={entry} onAction={onAction} onUninstall={onUninstall} />
    </article>
  );
}

function EntryAction({ entry, onAction, onUninstall }: CardProps) {
  const t = useTranslations('app.directory');

  if (entry.category === 'skill') {
    const active = entry.active_skill;
    return (
      <button
        type="button"
        onClick={onAction}
        aria-pressed={active}
        className={`self-start text-[12px] rounded-md px-3 py-1.5 font-medium active:scale-[0.97] transition-all duration-150 ${
          active
            ? 'bg-[var(--accent)] text-black hover:opacity-90'
            : 'bg-[var(--surface-2)] text-[var(--fg-2)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)]'
        }`}
      >
        {active ? t('action.skill.active') : t('action.skill.activate')}
      </button>
    );
  }

  if (entry.install_kind === 'internal') {
    return (
      <button
        type="button"
        onClick={onAction}
        className="self-start text-[12px] rounded-md px-3 py-1.5 bg-[var(--surface-2)] text-[var(--fg-2)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)] active:scale-[0.97] transition-all duration-150"
      >
        {entry.installed
          ? t('action.internal.paired')
          : t('action.internal.pair')}
      </button>
    );
  }

  if (entry.installed) {
    return (
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--accent)]">
          {t('action.installed')}
        </span>
        <button
          type="button"
          onClick={onUninstall}
          className="text-[12px] text-[var(--fg-3)] hover:text-[var(--fg)] transition-colors"
        >
          {t('action.remove')}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onAction}
      className="self-start text-[12px] rounded-md px-3 py-1.5 bg-[var(--surface-2)] text-[var(--fg-2)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)] active:scale-[0.97] transition-all duration-150"
    >
      {t('action.install')}
    </button>
  );
}

function EntryIcon({ icon, name }: { icon: string; name: string }) {
  return (
    <span
      aria-hidden
      className="relative inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--surface-2)] text-[var(--fg-2)] text-[11px] font-medium shrink-0 overflow-hidden"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={icon}
        alt=""
        className="w-5 h-5"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
      <span className="absolute inset-0 -z-10 flex items-center justify-center">
        {name.charAt(0)}
      </span>
    </span>
  );
}
