'use client';

/**
 * DirectoryShell — `/app/directory` client island.
 *
 * Information architecture borrows from ChatGPT's "Explore" surface:
 *   1. Header: title + search top-right.
 *   2. Filter pill bar (Top picks / Skills / Conectores / Pinned) +
 *      pin-counter chip on the right.
 *   3. Top picks (default): a Featured 2x2 grid of the official Vizzor
 *      integrations, then a numbered ranked list of every Skill, then
 *      a numbered ranked list of every Connector.
 *   4. Any non-default filter (or a non-empty search) collapses the
 *      sectioned view into a single grid.
 *
 * Per-card interactions are unchanged from v0.4.1:
 *   - Skills are single-select. The active skill gets a teal hairline
 *     ring + an "Activa" status pill in the footer. Clicking toggles
 *     activation (PATCH /api/directory/skills/active).
 *   - Connectors are multi-install. Telegram is the "internal" kind
 *     and deep-links to /account#integrations. Anything else opens the
 *     InstallSheet for credential entry.
 *   - Every card carries a pin button (top-right). Pins surface in the
 *     composer "+" picker. Hard cap: MAX_PINNED_ITEMS per wallet.
 *
 * SWR-fetches /api/directory/catalog; the cache is mutated after every
 * state change so cards flip without a page reload.
 */

import {
  useMemo,
  useState,
  useTransition,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useTranslations } from 'next-intl';
import { Pin, Search } from 'lucide-react';
import { toast } from 'sonner';
import { InstallSheet, type InstallTarget } from './install-sheet';

// Keep in sync with MAX_PINNED_ITEMS in lib/directory/runtime.ts. The
// runtime constant is the source of truth (server-side gate); this
// copy is for the UI affordance only.
const MAX_PINNED_ITEMS = 5;

type Category = 'skill' | 'connector';
type Filter = 'top' | 'skill' | 'connector' | 'pinned';

const FILTERS: ReadonlyArray<Filter> = ['top', 'skill', 'connector', 'pinned'];

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
  popular_rank: number;
  partner_tier: 'vizzor' | 'partner' | 'community';
  install_kind: 'internal' | 'webhook' | 'apikey' | 'skill';
  status_text?: string;
  config_schema: ConfigSchema | null;
  external_docs?: string;
  installed: boolean;
  install_id: string | null;
  active_skill: boolean;
  pinned: boolean;
  locked: boolean;
  required_tier: 'free' | 'pro' | 'elite';
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
  const [filter, setFilter] = useState<Filter>('top');
  const [query, setQuery] = useState('');
  const [installTarget, setInstallTarget] = useState<InstallTarget | null>(null);
  const [, startTransition] = useTransition();
  const { mutate } = useSWRConfig();
  const { data, isLoading } = useSWR(CATALOG_URL, fetcher, {
    revalidateOnFocus: true,
  });

  const entries = data?.entries ?? [];
  const pinnedCount = useMemo(
    () => entries.reduce((n, e) => (e.pinned ? n + 1 : n), 0),
    [entries],
  );
  const atPinCap = pinnedCount >= MAX_PINNED_ITEMS;

  // Substring match on name + summary, case-insensitive. Empty query
  // is the identity filter — sectioned view stays intact.
  const matchesQuery = (entry: HydratedEntry): boolean => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      entry.name.toLowerCase().includes(q) ||
      entry.summary.toLowerCase().includes(q)
    );
  };

  // Sectioned dataset (Top picks). Each section pulls from the same
  // queried set so a search narrows everything in lockstep.
  const featured = useMemo<HydratedEntry[]>(() => {
    return entries
      .filter(matchesQuery)
      .filter((e) => e.partner_tier === 'vizzor')
      .sort((a, b) => a.popular_rank - b.popular_rank)
      .slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, query]);

  const rankedSkills = useMemo<HydratedEntry[]>(() => {
    return entries
      .filter(matchesQuery)
      .filter((e) => e.category === 'skill')
      .sort((a, b) => a.popular_rank - b.popular_rank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, query]);

  const rankedConnectors = useMemo<HydratedEntry[]>(() => {
    return entries
      .filter(matchesQuery)
      .filter((e) => e.category === 'connector')
      .sort((a, b) => a.popular_rank - b.popular_rank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, query]);

  // Single-grid datasets used when a non-default filter is active OR
  // when the user is searching (sectioned view feels noisy under a
  // query — flatten it).
  const flatVisible = useMemo<HydratedEntry[]>(() => {
    const base = entries.filter(matchesQuery);
    if (filter === 'pinned') return base.filter((e) => e.pinned);
    if (filter === 'skill') return base.filter((e) => e.category === 'skill');
    if (filter === 'connector') return base.filter((e) => e.category === 'connector');
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, query, filter]);

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

  async function togglePin(entry: HydratedEntry) {
    const next = !entry.pinned;
    if (next && atPinCap) {
      toast.error(t('pin.limitTitle'), {
        description: t('pin.limitBody', { max: MAX_PINNED_ITEMS }),
      });
      return;
    }
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
      const res = await fetch('/api/directory/pinned', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ item_id: entry.id, pinned: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { reason?: string; limit?: number }
          | null;
        if (body?.reason === 'pin_limit_reached') {
          toast.error(t('pin.limitTitle'), {
            description: t('pin.limitBody', {
              max: body.limit ?? MAX_PINNED_ITEMS,
            }),
          });
        }
      }
    } finally {
      mutate(CATALOG_URL);
    }
  }

  function onAction(entry: HydratedEntry) {
    if (entry.locked) {
      const locale =
        typeof window !== 'undefined'
          ? window.location.pathname.split('/')[1] || 'en'
          : 'en';
      window.location.href = `/${locale}/pricing`;
      return;
    }
    if (entry.category === 'skill') {
      // Single-select toggle. Tapping the active skill clears it.
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
    if (entry.installed && entry.install_id) {
      // Already installed → manage = uninstall, exposed inline on the
      // card's status pill so the card body click stays a no-op for
      // the safety-rail case (avoid an accidental uninstall on click).
      return;
    }
    setInstallTarget({
      connectorId: entry.id,
      name: entry.name,
      category: entry.category,
      schema: entry.config_schema,
    });
  }

  const cardHandlers = {
    onAction,
    onTogglePin: togglePin,
    onUninstall: (entry: HydratedEntry) =>
      entry.install_id && void uninstall(entry.install_id),
    pinDisabledFor: (entry: HydratedEntry) => !entry.pinned && atPinCap,
  };

  const showSectioned = filter === 'top' && query.trim().length === 0;

  return (
    <>
      {/* Header — title block left, search top-right. The search field
          carries weight by sitting alone on the right edge; on mobile
          it stacks below the title block. */}
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-8">
        <div className="max-w-[64ch]">
          <p className="mono tabular text-[10.5px] uppercase tracking-[0.18em] text-[var(--accent)]">
            {t('eyebrow')}
          </p>
          <h1 className="mt-1 display text-[28px] sm:text-[32px] leading-tight tracking-tight font-semibold text-[var(--fg)]">
            {t('title')}
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-[var(--fg-2)]">
            {t('body')}
          </p>
        </div>
        <label className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 w-full md:w-[300px] shrink-0 focus-within:border-[var(--fg-3)] transition-colors">
          <Search
            size={14}
            strokeWidth={1.75}
            className="text-[var(--fg-3)] shrink-0"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            className="flex-1 min-w-0 bg-transparent text-[13px] text-[var(--fg)] outline-none placeholder:text-[var(--fg-3)]"
          />
        </label>
      </header>

      {/* Filter pills + pin counter. The active pill mirrors the user
          bubble's solid-fg fill so it reads as "currently focused". */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <nav
          className="flex flex-wrap items-center gap-2"
          aria-label={t('nav.label')}
        >
          {FILTERS.map((key) => {
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                aria-pressed={active}
                className={`inline-flex items-center h-9 px-4 rounded-full text-[12.5px] font-medium transition-colors ${
                  active
                    ? 'bg-[var(--fg)] text-[var(--bg)]'
                    : 'bg-[var(--surface)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]'
                }`}
              >
                {t(`filter.${key}`)}
              </button>
            );
          })}
        </nav>
        <span
          className={`inline-flex items-center gap-1.5 mono tabular text-[10.5px] uppercase tracking-[0.14em] shrink-0 ${
            atPinCap ? 'text-[var(--accent)]' : 'text-[var(--fg-3)]'
          }`}
          title={t('pin.counterTitle', { max: MAX_PINNED_ITEMS })}
        >
          <Pin
            size={11}
            strokeWidth={atPinCap ? 2.25 : 1.75}
            className={atPinCap ? 'fill-current' : ''}
            aria-hidden
          />
          {t('pin.counter', { used: pinnedCount, max: MAX_PINNED_ITEMS })}
        </span>
      </div>

      {isLoading ? (
        <p className="text-[13px] text-[var(--fg-3)]">{t('loading')}</p>
      ) : showSectioned ? (
        <div className="flex flex-col gap-12">
          {featured.length > 0 && (
            <Section
              title={t('section.featured.title')}
              subtitle={t('section.featured.subtitle')}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {featured.map((entry) => (
                  <FeaturedCard
                    key={entry.id}
                    entry={entry}
                    {...cardHandlers}
                    pinDisabled={cardHandlers.pinDisabledFor(entry)}
                  />
                ))}
              </div>
            </Section>
          )}

          {rankedSkills.length > 0 && (
            <Section
              title={t('section.skills.title')}
              subtitle={t('section.skills.subtitle')}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                {rankedSkills.map((entry, idx) => (
                  <RankedRow
                    key={entry.id}
                    rank={idx + 1}
                    entry={entry}
                    {...cardHandlers}
                    pinDisabled={cardHandlers.pinDisabledFor(entry)}
                  />
                ))}
              </div>
            </Section>
          )}

          {rankedConnectors.length > 0 && (
            <Section
              title={t('section.connectors.title')}
              subtitle={t('section.connectors.subtitle')}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                {rankedConnectors.map((entry, idx) => (
                  <RankedRow
                    key={entry.id}
                    rank={idx + 1}
                    entry={entry}
                    {...cardHandlers}
                    pinDisabled={cardHandlers.pinDisabledFor(entry)}
                  />
                ))}
              </div>
            </Section>
          )}
        </div>
      ) : flatVisible.length === 0 ? (
        <p className="text-[13px] text-[var(--fg-3)]">
          {query.trim() ? t('empty.noResults') : t(`empty.${filter}`)}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {flatVisible.map((entry) => (
            <FeaturedCard
              key={entry.id}
              entry={entry}
              {...cardHandlers}
              pinDisabled={cardHandlers.pinDisabledFor(entry)}
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

/* ──────────────────────── section header ──────────────────────── */

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="display text-[22px] sm:text-[24px] leading-tight tracking-tight font-semibold text-[var(--fg)]">
          {title}
        </h2>
        <p className="mt-1 text-[13px] text-[var(--fg-3)] leading-relaxed">
          {subtitle}
        </p>
      </header>
      {children}
    </section>
  );
}

/* ──────────────────────── card primitives ──────────────────────── */

interface CardHandlers {
  onAction: (entry: HydratedEntry) => void;
  onTogglePin: (entry: HydratedEntry) => void | Promise<void>;
  onUninstall: (entry: HydratedEntry) => void;
}

interface CardCommonProps extends CardHandlers {
  entry: HydratedEntry;
  pinDisabled?: boolean;
}

/**
 * FeaturedCard — large 2-col card used in the Featured grid and as the
 * flat fallback when a single filter is active. Icon left, identity +
 * description + footer stacked.
 */
function FeaturedCard({
  entry,
  onAction,
  onTogglePin,
  onUninstall,
  pinDisabled = false,
}: CardCommonProps) {
  const t = useTranslations('app.directory');
  const ringClass = entry.active_skill
    ? 'border-[var(--accent)] shadow-[inset_0_0_0_1px_var(--accent)]'
    : 'border-[var(--border)]';

  return (
    <article
      onClick={() => onAction(entry)}
      className={`relative flex items-start gap-4 rounded-xl border bg-[var(--surface)] p-4 cursor-pointer transition-colors hover:bg-[color-mix(in_oklab,var(--surface)_80%,var(--surface-2))] ${ringClass}`}
    >
      <CircleIcon icon={entry.icon} name={entry.name} size={44} />
      <div className="flex-1 min-w-0 pr-9">
        <h3 className="text-[14px] font-semibold text-[var(--fg)] leading-tight truncate">
          {entry.name}
        </h3>
        <p className="mt-1 text-[12.5px] leading-snug text-[var(--fg-2)] line-clamp-2">
          {entry.summary}
        </p>
        <CardFooter entry={entry} onUninstall={() => onUninstall(entry)} />
      </div>
      <PinButton
        entry={entry}
        disabled={pinDisabled}
        onToggle={(e) => {
          e.stopPropagation();
          void onTogglePin(entry);
        }}
        labels={{
          pin: t('pin.pin'),
          unpin: t('pin.unpin'),
          limitTitle: t('pin.limitTitle'),
        }}
      />
    </article>
  );
}

/**
 * RankedRow — compact numbered list item used in the Skills /
 * Connectors sections. Rank number left, then icon, then name +
 * summary + footer. Borderless rows lean on the section header for
 * grouping so the list reads as a single thing instead of N cards.
 */
function RankedRow({
  rank,
  entry,
  onAction,
  onTogglePin,
  onUninstall,
  pinDisabled = false,
}: CardCommonProps & { rank: number }) {
  const t = useTranslations('app.directory');
  return (
    <article
      onClick={() => onAction(entry)}
      className={`relative flex items-start gap-3 rounded-lg px-2 py-3 cursor-pointer transition-colors hover:bg-[var(--surface-2)] ${
        entry.active_skill ? 'bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]' : ''
      }`}
    >
      <span
        aria-hidden
        className="mono tabular text-[14px] tracking-tight text-[var(--fg-3)] w-5 text-right shrink-0 pt-2 leading-none"
      >
        {rank}
      </span>
      <CircleIcon icon={entry.icon} name={entry.name} size={40} />
      <div className="flex-1 min-w-0 pr-9">
        <h3 className="text-[13.5px] font-semibold text-[var(--fg)] leading-tight truncate">
          {entry.name}
        </h3>
        <p className="mt-0.5 text-[12px] leading-snug text-[var(--fg-2)] line-clamp-2">
          {entry.summary}
        </p>
        <CardFooter entry={entry} onUninstall={() => onUninstall(entry)} />
      </div>
      <PinButton
        entry={entry}
        disabled={pinDisabled}
        onToggle={(e) => {
          e.stopPropagation();
          void onTogglePin(entry);
        }}
        labels={{
          pin: t('pin.pin'),
          unpin: t('pin.unpin'),
          limitTitle: t('pin.limitTitle'),
        }}
      />
    </article>
  );
}

/**
 * Footer strip — "Por {partner_tier} · {status}". GPT shows "By X"
 * attribution; we extend that with the per-entry state (Activa,
 * Instalado, locked-tier badge) so the card carries its own status
 * without a separate action button.
 */
function CardFooter({
  entry,
  onUninstall,
}: {
  entry: HydratedEntry;
  onUninstall: () => void;
}) {
  const t = useTranslations('app.directory');
  const attribution = t(`partnerTier.${entry.partner_tier}`);

  let status: React.ReactNode = null;
  if (entry.locked) {
    status = (
      <span className="inline-flex items-center text-[10.5px] uppercase tracking-[0.12em] text-[var(--fg-3)] border border-[var(--border)] rounded-sm px-1 py-px">
        {entry.required_tier}
      </span>
    );
  } else if (entry.active_skill) {
    status = (
      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--accent)]">
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
        {t('state.active')}
      </span>
    );
  } else if (entry.installed && entry.category === 'connector') {
    if (entry.install_kind === 'internal') {
      status = (
        <span className="text-[11px] text-[var(--accent)]">
          {t('state.paired')}
        </span>
      );
    } else {
      status = (
        <span className="flex items-center gap-2 text-[11px]">
          <span className="text-[var(--accent)]">{t('state.installed')}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUninstall();
            }}
            className="text-[var(--fg-3)] hover:text-[var(--fg)] transition-colors underline-offset-2 hover:underline"
          >
            {t('action.remove')}
          </button>
        </span>
      );
    }
  }

  return (
    <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--fg-3)]">
      <span>{attribution}</span>
      {status && (
        <>
          <span aria-hidden className="text-[var(--fg-3)]/60">·</span>
          {status}
        </>
      )}
    </div>
  );
}

/* ──────────────────────── shared atoms ──────────────────────── */

function PinButton({
  entry,
  disabled,
  onToggle,
  labels,
}: {
  entry: HydratedEntry;
  disabled: boolean;
  onToggle: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  labels: { pin: string; unpin: string; limitTitle: string };
}) {
  if (entry.locked) return null;
  const aria = disabled ? labels.limitTitle : entry.pinned ? labels.unpin : labels.pin;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={entry.pinned}
      aria-label={aria}
      title={aria}
      className={`absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        entry.pinned
          ? 'text-[var(--accent)] hover:bg-[var(--surface-2)]'
          : disabled
            ? 'text-[var(--fg-3)]/40 cursor-not-allowed'
            : 'text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]'
      }`}
    >
      <Pin
        size={13}
        strokeWidth={entry.pinned ? 2.25 : 1.75}
        className={entry.pinned ? 'fill-current' : ''}
        aria-hidden
      />
    </button>
  );
}

/**
 * CircleIcon — round mask matches GPT's icon treatment. The image
 * fills the circle; the first letter of the entry name sits behind as
 * a fallback so a missing SVG never leaves an empty disc.
 */
function CircleIcon({
  icon,
  name,
  size,
}: {
  icon: string;
  name: string;
  size: number;
}) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="relative inline-flex items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--fg-2)] shrink-0 overflow-hidden"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={icon}
        alt=""
        className="absolute inset-0 m-auto"
        style={{ width: Math.round(size * 0.6), height: Math.round(size * 0.6) }}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
      <span
        className="absolute inset-0 flex items-center justify-center font-medium"
        style={{ fontSize: Math.round(size * 0.4) }}
      >
        {name.charAt(0).toUpperCase()}
      </span>
    </span>
  );
}
