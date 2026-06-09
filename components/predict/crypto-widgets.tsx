/**
 * Right-rail widgets for the Predict surface.
 *
 * Every card is backed by a real engine data shape:
 *   - TickersWidget        ← /v1/market/prices  (ticker[])
 *   - CalibrationHeatmap   ← /v1/chronovisor/:symbol/accuracy  (trackerWR.byHorizon)
 *   - TierPerformance      ← composite of byTier scoreboard rows
 *   - SignalFamiliesWidget ← engine signal categories (onChain · mlEnsemble · markets · narrative · pattern · logic)
 *   - ReceiptsWidget       ← /v1/chronovisor/predictions  (recentPredictions[])
 *
 * No "eyebrow tag" labels — each card leads with a clean title + the
 * data. Strictly achromatic; direction tokens (`--up`, `--down`) stay
 * paired with ▲/▼ glyphs so the read survives colour-blindness and
 * the strict B&W policy.
 */

import { cn } from '@/lib/utils';
import type { CalibrationBanner, Last24h } from '@/lib/snapshot';
import type { Prediction, Tier, TickerEntry, TrackerWR } from '@/lib/types';
import {
  IconActivity,
  IconArrowDown,
  IconArrowUp,
  IconChevronRight,
  IconDot,
  IconPrice,
  IconReceipts,
  IconSignal,
  IconWinRate,
} from './predict-icons';

/* ─────────────────────────── Shared chrome ─────────────────────────── */

interface WidgetCardProps {
  title: string;
  meta?: string;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  children: React.ReactNode;
  live?: boolean;
}

function WidgetCard({
  title,
  meta,
  icon,
  trailing,
  children,
  live,
}: WidgetCardProps) {
  return (
    <article
      className={cn(
        'flex flex-col gap-3',
        'rounded-2xl border border-[var(--border)]',
        'bg-[var(--surface)]',
        'p-4',
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {icon && (
            <span
              aria-hidden
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center shrink-0',
                'rounded-lg border border-[var(--border-hi)]',
                'bg-[var(--surface-2)] text-[var(--fg)]',
              )}
            >
              {icon}
            </span>
          )}
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-semibold text-[var(--fg)] leading-tight truncate">
              {title}
            </span>
            {meta && (
              <span className="text-[11px] text-[var(--fg-3)] truncate leading-tight mt-0.5">
                {meta}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {live && <LiveDot />}
          {trailing}
        </div>
      </header>
      <div>{children}</div>
    </article>
  );
}

function LiveDot() {
  return (
    <span
      aria-label="live"
      className="relative inline-flex items-center"
    >
      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--fg)]" />
      <span className="absolute left-0 inline-flex h-1.5 w-1.5 rounded-full bg-[var(--fg)] animate-ping motion-reduce:hidden opacity-60" />
    </span>
  );
}

/* ─────────────────────────── Live tickers ─────────────────────────── */

export interface TickersWidgetProps {
  tickers: TickerEntry[];
  priority?: readonly string[];
  limit?: number;
}

const DEFAULT_PRIORITY: readonly string[] = ['BTC', 'ETH', 'SOL', 'TON'];

export function TickersWidget({
  tickers,
  priority = DEFAULT_PRIORITY,
  limit = 4,
}: TickersWidgetProps) {
  const ordered = orderByPriority(tickers, priority).slice(0, limit);

  return (
    <WidgetCard
      title="Spot · 24h"
      meta="Aggregated across venues"
      icon={<IconPrice />}
      live
    >
      <ul className="flex flex-col">
        {ordered.map((t, i) => {
          const up = t.changePct >= 0;
          return (
            <li
              key={t.symbol}
              className={cn(
                'flex items-center justify-between gap-3 py-2',
                i !== 0 && 'border-t border-[var(--border)]',
              )}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <SymbolGlyph symbol={t.symbol} />
                <span className="flex flex-col min-w-0 leading-tight">
                  <span className="mono tabular text-[12px] font-semibold text-[var(--fg)] truncate">
                    {t.symbol}
                  </span>
                  <span className="mono tabular text-[10px] text-[var(--fg-3)] truncate">
                    {t.source ?? 'composite'}
                  </span>
                </span>
              </span>
              <span className="flex flex-col items-end shrink-0 leading-tight">
                <span className="mono tabular text-[12.5px] text-[var(--fg)]">
                  {formatPrice(t.price)}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 mono tabular text-[10.5px]',
                    up ? 'text-[var(--up)]' : 'text-[var(--down)]',
                  )}
                  aria-label={`${(t.changePct * 100).toFixed(2)} percent`}
                >
                  {up ? <IconArrowUp size={9} /> : <IconArrowDown size={9} />}
                  {(Math.abs(t.changePct) * 100).toFixed(2)}%
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </WidgetCard>
  );
}

function SymbolGlyph({ symbol }: { symbol: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center shrink-0',
        'rounded-md border border-[var(--border-hi)] bg-[var(--surface-2)]',
        'mono tabular text-[10px] font-bold uppercase text-[var(--fg)]',
        'tracking-tight',
      )}
    >
      {symbol.slice(0, 3)}
    </span>
  );
}

/* ─────────────────────────── Calibration heatmap (per-horizon WR) ─────────────────────────── */

export interface CalibrationHeatmapProps {
  wr: TrackerWR;
  banner?: CalibrationBanner;
  /** Show only these horizons in order; others get clipped. */
  horizons?: readonly string[];
}

const DEFAULT_HORIZONS: readonly string[] = [
  '15m',
  '1h',
  '4h',
  '1d',
  '7d',
  '30d',
];

export function CalibrationHeatmap({
  wr,
  banner,
  horizons = DEFAULT_HORIZONS,
}: CalibrationHeatmapProps) {
  const rows = horizons
    .map((h) => {
      const bucket = wr.byHorizon[h];
      if (!bucket) return null;
      return { horizon: h, wr: bucket.wr, samples: bucket.samples };
    })
    .filter(
      (r): r is { horizon: string; wr: number; samples: number } => r !== null,
    );

  return (
    <WidgetCard
      title={`Tracked WR ${(wr.aggregate.wr * 100).toFixed(1)}%`}
      meta={
        banner
          ? `${banner.version} · n=${wr.aggregate.samples.toLocaleString('en-US')}`
          : `n=${wr.aggregate.samples.toLocaleString('en-US')}`
      }
      icon={<IconWinRate />}
    >
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => {
          const widthPct = Math.max(0, Math.min(100, r.wr * 100));
          return (
            <li
              key={r.horizon}
              className="flex items-center gap-2 mono tabular text-[11px]"
            >
              <span className="w-8 shrink-0 text-[var(--fg-3)] uppercase tracking-[0.12em]">
                {r.horizon}
              </span>
              <span
                className="relative flex-1 h-1.5 rounded-full overflow-hidden bg-[var(--surface-2)]"
                role="meter"
                aria-label={`${r.horizon} win rate`}
                aria-valuenow={Math.round(widthPct)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span
                  className="absolute inset-y-0 left-0 bg-[var(--fg)] rounded-full"
                  style={{ width: `${widthPct}%` }}
                />
              </span>
              <span className="w-10 shrink-0 text-right text-[var(--fg)]">
                {(r.wr * 100).toFixed(0)}%
              </span>
              <span className="w-8 shrink-0 text-right text-[var(--fg-3)]">
                {compactSamples(r.samples)}
              </span>
            </li>
          );
        })}
      </ul>
    </WidgetCard>
  );
}

/* ─────────────────────────── Tier performance ─────────────────────────── */

export interface TierPerformanceWidgetProps {
  wr: TrackerWR;
}

const TIER_ORDER: readonly Tier[] = [
  'high-conviction',
  'whale-confirmed',
  'tracked',
  'advisory',
];

const TIER_LABEL: Record<Tier, string> = {
  'high-conviction': 'High conviction',
  'whale-confirmed': 'Whale confirmed',
  tracked: 'Tracked',
  advisory: 'Advisory',
};

export function TierPerformanceWidget({ wr }: TierPerformanceWidgetProps) {
  const rows = TIER_ORDER.map((tier) => ({
    tier,
    label: TIER_LABEL[tier],
    bucket: wr.byTier[tier],
  })).filter((r) => r.bucket && r.bucket.samples > 0);

  return (
    <WidgetCard
      title="Conviction ladder"
      meta="Resolved samples · last 90d"
      icon={<IconSignal />}
    >
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li
            key={r.tier}
            className={cn(
              'flex items-center justify-between gap-2',
              'rounded-lg border border-[var(--border)] bg-[var(--surface-2)]',
              'px-3 py-2',
            )}
          >
            <span className="flex flex-col leading-tight min-w-0">
              <span className="text-[12px] font-semibold text-[var(--fg)] truncate">
                {r.label}
              </span>
              <span className="mono tabular text-[10px] text-[var(--fg-3)]">
                n={r.bucket.samples.toLocaleString('en-US')}
              </span>
            </span>
            <span className="mono tabular text-[14px] font-bold text-[var(--fg)]">
              {(r.bucket.wr * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

/* ─────────────────────────── Signal families ─────────────────────────── */

interface FamilyDef {
  key: string;
  label: string;
  weight: number;
  note: string;
}

const SIGNAL_FAMILIES: ReadonlyArray<FamilyDef> = [
  { key: 'onChain', label: 'On-chain', weight: 0.23, note: 'whales · flow · concentration' },
  { key: 'mlEnsemble', label: 'ML ensemble', weight: 0.32, note: 'xgboost · lightgbm · isotonic' },
  { key: 'predictionMarkets', label: 'Markets', weight: 0.15, note: 'polymarket · gamma' },
  { key: 'socialNarrative', label: 'Narrative', weight: 0.15, note: 'cryptopanic · llm catalyst' },
  { key: 'patternMatch', label: 'Pattern', weight: 0.1, note: 'smc · ict · pattern library' },
  { key: 'logicRules', label: 'Logic rules', weight: 0.05, note: 'fol · 21 rules tracked' },
];

export function SignalFamiliesWidget() {
  return (
    <WidgetCard
      title="Signal families"
      meta="Ensemble composition · weights learn online"
      icon={<IconActivity />}
    >
      <ul className="flex flex-col gap-1.5">
        {SIGNAL_FAMILIES.map((f) => {
          const pct = Math.round(f.weight * 100);
          return (
            <li key={f.key} className="flex items-center gap-2">
              <span className="w-[88px] shrink-0 flex flex-col leading-tight">
                <span className="text-[11.5px] font-semibold text-[var(--fg)] truncate">
                  {f.label}
                </span>
                <span className="text-[9.5px] text-[var(--fg-3)] truncate">
                  {f.note}
                </span>
              </span>
              <span className="relative flex-1 h-1 rounded-full overflow-hidden bg-[var(--surface-2)]">
                <span
                  className="absolute inset-y-0 left-0 bg-[var(--fg)] rounded-full"
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="mono tabular text-[10.5px] text-[var(--fg-2)] w-7 text-right">
                {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </WidgetCard>
  );
}

/* ─────────────────────────── Last 24h ─────────────────────────── */

export interface Last24hWidgetProps {
  last24h: Last24h;
}

export function Last24hWidget({ last24h }: Last24hWidgetProps) {
  const cells: ReadonlyArray<{
    key: keyof Last24h;
    label: string;
    value: number;
    tone: 'up' | 'down' | 'neutral';
  }> = [
    { key: 'hits', label: 'hits', value: last24h.hits, tone: 'up' },
    { key: 'misses', label: 'misses', value: last24h.misses, tone: 'down' },
    { key: 'neutrals', label: 'neut', value: last24h.neutrals, tone: 'neutral' },
    { key: 'pending', label: 'pend', value: last24h.pending, tone: 'neutral' },
  ];

  return (
    <WidgetCard
      title={`Decisive WR ${(last24h.decisiveWR * 100).toFixed(1)}%`}
      meta="Last 24h · resolved cohort"
      icon={<IconActivity />}
    >
      <ul className="grid grid-cols-4 gap-1.5">
        {cells.map((c) => (
          <li
            key={c.key}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5',
              'rounded-md border border-[var(--border)]',
              'bg-[var(--surface-2)]',
              'py-2',
            )}
          >
            <span
              className={cn(
                'mono tabular text-[14px] font-bold leading-none',
                c.tone === 'up'
                  ? 'text-[var(--up)]'
                  : c.tone === 'down'
                    ? 'text-[var(--down)]'
                    : 'text-[var(--fg)]',
              )}
            >
              {c.value}
            </span>
            <span className="mono tabular text-[9px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
              {c.label}
            </span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

/* ─────────────────────────── Recent receipts ─────────────────────────── */

export interface ReceiptsWidgetProps {
  receipts: Prediction[];
  limit?: number;
}

export function ReceiptsWidget({ receipts, limit = 3 }: ReceiptsWidgetProps) {
  const items = receipts.slice(0, limit);

  return (
    <WidgetCard
      title="Receipts"
      meta={`${receipts.length} on the public ledger`}
      icon={<IconReceipts />}
      trailing={
        <button
          type="button"
          className={cn(
            'inline-flex items-center justify-center shrink-0',
            'h-6 w-6 rounded-full border border-[var(--border)]',
            'text-[var(--fg-3)] hover:text-[var(--fg)] hover:border-[var(--fg)]',
            'transition-colors',
          )}
          aria-label="View all receipts"
        >
          <IconChevronRight size={11} />
        </button>
      }
    >
      <ul className="flex flex-col gap-2">
        {items.map((p) => (
          <li
            key={p.id}
            className={cn(
              'flex flex-col gap-1',
              'rounded-xl border border-[var(--border)] bg-[var(--surface-2)]',
              'px-3 py-2',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="mono tabular text-[12px] font-bold text-[var(--fg)]">
                  {p.symbol}
                </span>
                <span className="mono tabular text-[10px] text-[var(--fg-3)] uppercase tracking-[0.12em]">
                  · {p.horizon}
                </span>
                <DirectionChip direction={p.direction} />
              </span>
              <OutcomeChip outcome={p.outcome} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="mono tabular text-[10.5px] text-[var(--fg-3)]">
                conf {(p.confidence * 100).toFixed(0)}%
              </span>
              <span className="mono tabular text-[10px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
                {p.tier}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

function DirectionChip({ direction }: { direction: Prediction['direction'] }) {
  if (direction === 'up') {
    return (
      <span
        className="inline-flex items-center gap-0.5 mono tabular text-[10px] text-[var(--up)]"
        aria-label="upward direction"
      >
        <IconArrowUp size={9} />
      </span>
    );
  }
  if (direction === 'down') {
    return (
      <span
        className="inline-flex items-center gap-0.5 mono tabular text-[10px] text-[var(--down)]"
        aria-label="downward direction"
      >
        <IconArrowDown size={9} />
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center mono tabular text-[10px] text-[var(--fg-3)]"
      aria-label="sideways"
    >
      —
    </span>
  );
}

function OutcomeChip({ outcome }: { outcome: Prediction['outcome'] }) {
  if (!outcome || outcome === 'pending') {
    return (
      <span className="mono tabular text-[9.5px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
        pending
      </span>
    );
  }
  if (outcome === 'hit') {
    return (
      <span className="mono tabular text-[9.5px] uppercase tracking-[0.16em] text-[var(--up)]">
        hit
      </span>
    );
  }
  if (outcome === 'miss') {
    return (
      <span className="mono tabular text-[9.5px] uppercase tracking-[0.16em] text-[var(--down)]">
        miss
      </span>
    );
  }
  return (
    <span className="mono tabular text-[9.5px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
      neut
    </span>
  );
}

/* ─────────────────────────── helpers ─────────────────────────── */

function orderByPriority(
  tickers: readonly TickerEntry[],
  priority: readonly string[],
): TickerEntry[] {
  const map = new Map<string, TickerEntry>();
  for (const t of tickers) map.set(t.symbol.toUpperCase(), t);
  const ordered: TickerEntry[] = [];
  for (const sym of priority) {
    const found = map.get(sym.toUpperCase());
    if (found) {
      ordered.push(found);
      map.delete(sym.toUpperCase());
    }
  }
  for (const t of map.values()) ordered.push(t);
  return ordered;
}

function formatPrice(value: number): string {
  if (value >= 1000) {
    return `$${value.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  }
  if (value >= 1) {
    return `$${value.toFixed(2)}`;
  }
  if (value >= 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toPrecision(4)}`;
}

function compactSamples(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

/* ─────────────────────────── Engine slash-command catalog ─────────────────────────── */

/**
 * Exported so the composer's slash-command palette can present the
 * same canonical command set the engine actually understands. Keep in
 * sync with src/ai/tools.ts in the vizzor backend.
 */
export interface SlashCommandSpec {
  command: string;
  label: string;
  body: string;
  example: string;
  group: 'predict' | 'data' | 'forensics' | 'macro' | 'meta';
}

export const ENGINE_SLASH_COMMANDS: ReadonlyArray<SlashCommandSpec> = [
  {
    command: '/predict',
    label: 'ChronoVisor prediction',
    body: 'Composite prediction across the six signal families. Outputs direction, calibrated confidence, forecast envelope.',
    example: '/predict BTC 4h',
    group: 'predict',
  },
  {
    command: '/wr',
    label: 'Win rate',
    body: 'Resolved win rate for the public scoreboard. Filterable by symbol and horizon.',
    example: '/wr BTC 4h',
    group: 'meta',
  },
  {
    command: '/precisions',
    label: 'Recent receipts',
    body: 'Last N predictions with direction, confidence, outcome.',
    example: '/precisions',
    group: 'meta',
  },
  {
    command: '/price',
    label: 'Spot price',
    body: 'Aggregated spot + 24h change + derivatives snapshot.',
    example: '/price BTC',
    group: 'data',
  },
  {
    command: '/derivs',
    label: 'Derivatives pulse',
    body: 'Funding rate, open interest, long/short ratio, top-trader positioning, taker buy/sell.',
    example: '/derivs ETH',
    group: 'data',
  },
  {
    command: '/whales',
    label: 'Whale activity',
    body: 'Recent >$100k transfers, holder concentration, accumulation vs distribution.',
    example: '/whales SOL',
    group: 'data',
  },
  {
    command: '/sentiment',
    label: 'Narrative sentiment',
    body: 'CryptoPanic NLP + Claude catalyst classifier + emerging narratives.',
    example: '/sentiment ETH',
    group: 'data',
  },
  {
    command: '/audit',
    label: 'Token security audit',
    body: 'GoPlus security check, rug indicators, creator reputation, approval risk.',
    example: '/audit 0xabc… eth',
    group: 'forensics',
  },
  {
    command: '/trenches',
    label: 'Fresh DEX launches',
    body: 'New pairs on Solana / Ethereum / Base with liquidity + safety scores.',
    example: '/trenches solana',
    group: 'forensics',
  },
  {
    command: '/macro',
    label: 'Macro context',
    body: 'DXY trend, Fed stance, yields, BTC-S&P correlation, economic calendar.',
    example: '/macro',
    group: 'macro',
  },
  {
    command: '/calibration',
    label: 'Calibration trust',
    body: 'Per-horizon WR + expected calibration error. Surfaces which horizons to trust.',
    example: '/calibration BTC',
    group: 'meta',
  },
  {
    command: '/help',
    label: 'Command list',
    body: 'Full list of slash commands available in this chat.',
    example: '/help',
    group: 'meta',
  },
];
