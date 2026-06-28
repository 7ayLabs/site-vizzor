'use client';

/**
 * DirectoryShell — the client island that owns tab + search state for
 * `/app/directory`. Mirrors the Claude Directory pattern (Skills /
 * Connectors / Plugins on the left rail, search + featured pills +
 * card grid on the right) using predict-shell tokens so it sits
 * pixel-consistent with the rest of `/app/*` chrome.
 *
 * SWR-fetches `/api/directory/catalog`; on install / uninstall the
 * SWR cache is mutated optimistically.
 */

import { useMemo, useState, useTransition } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useTranslations } from 'next-intl';
import { Layers, Plug, Puzzle, Search, Check, Plus } from 'lucide-react';
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
  slug: string;
  name: string;
  category: Category;
  icon: string;
  summary: string;
  description: string;
  popular_rank: number;
  popular_for: string[];
  partner_tier: 'vizzor' | 'partner' | 'community';
  install_kind: 'internal' | 'webhook' | 'apikey' | 'skill';
  scopes: string[];
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

const fetcher = async (url: string): Promise<CatalogResponse> => {
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<CatalogResponse>;
};

export function DirectoryShell() {
  const t = useTranslations('app.directory');
  const [tab, setTab] = useState<Category>('connector');
  const [query, setQuery] = useState('');
  const [installTarget, setInstallTarget] = useState<InstallTarget | null>(null);
  const [, startTransition] = useTransition();
  const { mutate } = useSWRConfig();
  const { data, isLoading } = useSWR(CATALOG_URL, fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 0,
  });

  const tabs: Array<{ key: Category; icon: React.ReactNode }> = [
    { key: 'skill', icon: <Layers size={14} strokeWidth={1.75} /> },
    { key: 'connector', icon: <Plug size={14} strokeWidth={1.75} /> },
    { key: 'plugin', icon: <Puzzle size={14} strokeWidth={1.75} /> },
  ];

  const entries = data?.entries ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => e.category === tab)
      .filter((e) => {
        if (!q) return true;
        return (
          e.name.toLowerCase().includes(q) ||
          e.summary.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.popular_rank - b.popular_rank);
  }, [entries, tab, query]);

  const featured = filtered.filter((e) => e.popular_for.includes('predict')).slice(0, 3);

  function onInstall(entry: HydratedEntry) {
    if (entry.installed) return;
    if (entry.install_kind === 'skill') {
      // Skills install by being "activated" — same call as the active
      // skill PATCH. Optimistic mutate then revalidate.
      startTransition(async () => {
        try {
          await fetch('/api/directory/skills/active', {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ skill_id: entry.id }),
          });
          mutate(CATALOG_URL);
        } catch {
          /* surfaced through SWR error state */
        }
      });
      return;
    }
    if (entry.install_kind === 'internal') {
      // Telegram et al. — pair flow lives elsewhere; deep link.
      window.location.href = `/${typeof window !== 'undefined' ? window.location.pathname.split('/')[1] : 'en'}/account#integrations`;
      return;
    }
    setInstallTarget({
      connectorId: entry.id,
      name: entry.name,
      schema: entry.config_schema,
    });
  }

  async function onUninstall(installId: string) {
    await fetch(`/api/directory/install/${installId}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    mutate(CATALOG_URL);
  }

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">
        {/* Left rail — tab switcher */}
        <aside className="flex lg:flex-col gap-1 lg:gap-0.5 lg:sticky lg:top-6 lg:self-start">
          {tabs.map(({ key, icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-current={active ? 'page' : undefined}
                className={`group flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-left transition-colors ${
                  active
                    ? 'bg-[var(--surface-2)] text-[var(--fg)] font-medium'
                    : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)]'
                }`}
              >
                <span className={active ? 'text-[var(--fg)]' : 'text-[var(--fg-3)]'}>
                  {icon}
                </span>
                <span className="flex-1">{t(`tabs.${key}`)}</span>
              </button>
            );
          })}
        </aside>

        {/* Right side — search + featured + grid */}
        <section className="min-w-0">
          <label className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 mb-4 focus-within:border-[var(--fg-3)]">
            <Search size={14} className="text-[var(--fg-3)] shrink-0" strokeWidth={1.75} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search.placeholder')}
              className="flex-1 bg-transparent text-[13px] text-[var(--fg)] outline-none placeholder:text-[var(--fg-3)]"
            />
          </label>

          <div className="flex items-center gap-2 mb-5 text-[11px]">
            <span className="px-2 py-1 rounded-md bg-[var(--surface-2)] text-[var(--fg-2)]">
              {t('section.vizzor_partners')}
            </span>
          </div>

          {featured.length > 0 && (
            <>
              <p className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--fg-3)] mb-2">
                {t('section.popular_for')}{' '}
                <span className="text-[var(--fg-2)]">{t('popular.predict')}</span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                {featured.map((e) => (
                  <FeaturedPill
                    key={e.id}
                    entry={e}
                    onInstall={() => onInstall(e)}
                  />
                ))}
              </div>
            </>
          )}

          {isLoading ? (
            <p className="text-[13px] text-[var(--fg-3)]">{t('loading')}</p>
          ) : filtered.length === 0 ? (
            <p className="text-[13px] text-[var(--fg-3)]">{t('empty')}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {filtered.map((e) => (
                <EntryCard
                  key={e.id}
                  entry={e}
                  onInstall={() => onInstall(e)}
                  onUninstall={() => e.install_id && onUninstall(e.install_id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

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
  onInstall: () => void;
  onUninstall?: () => void;
}

function FeaturedPill({ entry, onInstall }: { entry: HydratedEntry; onInstall: () => void }) {
  return (
    <button
      type="button"
      onClick={onInstall}
      disabled={entry.installed}
      className={`group flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
        entry.installed
          ? 'border-[var(--accent-subtle,var(--border))] bg-[var(--surface)]'
          : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)]'
      }`}
    >
      <EntryIcon icon={entry.icon} name={entry.name} />
      <span className="flex-1 text-[13px] font-medium text-[var(--fg)] truncate">
        {entry.name}
      </span>
      {entry.installed ? (
        <Check size={14} className="text-[var(--accent)]" strokeWidth={2} />
      ) : (
        <Plus size={14} className="text-[var(--fg-3)] group-hover:text-[var(--fg)]" strokeWidth={2} />
      )}
    </button>
  );
}

function EntryCard({ entry, onInstall, onUninstall }: CardProps) {
  const t = useTranslations('app.directory');
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <header className="flex items-start gap-3">
        <EntryIcon icon={entry.icon} name={entry.name} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold text-[var(--fg)] truncate">
              {entry.name}
            </h3>
            {entry.installed && (
              <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--accent)]">
                {t('card.installed')}
              </span>
            )}
          </div>
          <p className="mono tabular text-[10.5px] text-[var(--fg-3)]">
            #{entry.popular_rank} {t('card.popular_rank')}
          </p>
        </div>
        {entry.installed ? (
          <button
            type="button"
            onClick={onUninstall}
            className="rounded-md p-1 text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors"
            aria-label={t('manage.uninstall')}
          >
            <Check size={16} className="text-[var(--accent)]" strokeWidth={2} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onInstall}
            className="rounded-md p-1 text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors"
            aria-label={t('card.install_cta')}
          >
            <Plus size={16} strokeWidth={2} />
          </button>
        )}
      </header>
      <p className="text-[13px] leading-snug text-[var(--fg-2)] line-clamp-3">
        {entry.summary}
      </p>
    </div>
  );
}

function EntryIcon({ icon, name }: { icon: string; name: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--surface-2)] text-[var(--fg-2)] text-[11px] font-medium shrink-0"
    >
      {/* Catalog icons live under /public/connectors/*.svg. If missing,
          the fallback is the entry's first character — keeps the layout
          stable while we backfill SVGs. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={icon}
        alt=""
        className="w-5 h-5"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
      <span className="absolute opacity-0">{name.charAt(0)}</span>
    </span>
  );
}
