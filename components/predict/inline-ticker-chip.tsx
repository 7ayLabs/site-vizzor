'use client';

/**
 * InlineTickerChip — compact ticker affordance rendered inline with the
 * "VIZZOR · HH:MM:SS" header on each assistant turn.
 *
 * Replaces the wide `TickerStack` card that used to render between the
 * user bubble and the assistant response. The wide card was being read
 * as "Vizzor's prediction" when it's actually just the live price — the
 * inline chip is direction-tinted but visually subordinate to the
 * response itself, which removes the confusion.
 *
 * Sizing mirrors the header it sits next to: 9.5px monospace, low
 * opacity, no border so it reads as metadata rather than a content card.
 *
 * Icon contract: the coin logo CDN can 404 on long-tail tokens (DASH,
 * LINK, …). When that happens we drop the icon entirely instead of
 * showing a duplicate-of-the-symbol monogram next to the symbol label.
 * The chip still carries SYMBOL · $price · ▼/▲ pct — the user gets
 * everything that matters even without the logo.
 */

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Image from 'next/image';
import { CoinIcon } from '@/components/ui/coin-icon';
import { coinIconUrl, TOP_20, TOP_20_BY_SYMBOL } from '@/lib/coin-meta';
import { cn } from '@/lib/utils';

export interface InlineTickerChipEntry {
  symbol: string;
  price?: number;
  changePct?: number;
}

export function InlineTickerChip({
  symbol,
  price,
  changePct,
  className,
}: InlineTickerChipEntry & { className?: string }) {
  const upperSymbol = symbol.toUpperCase();
  const isUp = (changePct ?? 0) >= 0;
  const deltaPct = typeof changePct === 'number' ? changePct * 100 : null;
  const [iconFailed, setIconFailed] = useState(false);
  const meta = TOP_20_BY_SYMBOL[upperSymbol];
  const iconKey = meta?.iconKey ?? upperSymbol.toLowerCase();

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 align-middle',
        // 70% opacity baseline matches the muted header tokens and keeps
        // the chip clearly subordinate to the response body.
        'opacity-70',
        className,
      )}
    >
      {!iconFailed && (
        <Image
          src={coinIconUrl(iconKey)}
          alt=""
          width={12}
          height={12}
          unoptimized
          onError={() => setIconFailed(true)}
          className="inline-block shrink-0 rounded-full"
        />
      )}
      <span className="mono tabular text-[9.5px] font-semibold text-[var(--fg-2)]">
        {upperSymbol}
      </span>
      {typeof price === 'number' && price > 0 && (
        <span
          key={price}
          className="motion-safe:vz-price-tick mono tabular text-[9.5px] text-[var(--fg-2)] normal-case"
        >
          {formatInlinePrice(price)}
        </span>
      )}
      {deltaPct !== null && Number.isFinite(deltaPct) && (
        <span
          className="mono tabular text-[9.5px] font-semibold inline-flex items-center gap-0.5 normal-case"
          style={{ color: isUp ? 'var(--up)' : 'var(--down)' }}
        >
          <span aria-hidden>{isUp ? '▲' : '▼'}</span>
          {Math.abs(deltaPct).toFixed(2)}%
        </span>
      )}
    </span>
  );
}

/**
 * Group of inline ticker chips.
 *
 *   - layout="inline" — chips always render side by side; layout work
 *     is the caller's problem.
 *   - layout="auto"   — chips render inline as long as they fit in the
 *     header row without wrapping. The moment they'd overflow (any
 *     viewport: desktop, tablet, mobile) the group flips to a compact
 *     toggle on the header + a wrapped chip row below. Detection is
 *     measurement-based, NOT count-based: 3 chips on a narrow mobile
 *     header may collapse, while 6 chips on a wide desktop header may
 *     stay inline. Synchronous via useLayoutEffect, so the swap
 *     happens before browser paint — no flash of overflowing chips.
 */
export function InlineTickerChipGroup({
  entries,
  className,
  layout = 'inline',
}: {
  entries: ReadonlyArray<InlineTickerChipEntry>;
  className?: string;
  layout?: 'inline' | 'auto';
}) {
  const [open, setOpen] = useState(false);
  const [overflowed, setOverflowed] = useState(false);
  const chipRef = useRef<HTMLSpanElement | null>(null);

  // Synchronous wrap detection — runs after layout but before paint.
  // We compare the chip span's top to the header's first child's top;
  // if the chip span sits on a row below the role label, it wrapped
  // because the row was too narrow → flip to collapsed mode.
  useLayoutEffect(() => {
    if (layout !== 'auto') return;
    const chip = chipRef.current;
    if (!chip) return;
    const header = chip.parentElement;
    if (!header) return;

    const check = (): void => {
      const first = header.firstElementChild;
      if (!first || first === chip) return;
      const firstTop = first.getBoundingClientRect().top;
      const chipTop = chip.getBoundingClientRect().top;
      // 2px tolerance for sub-pixel baseline differences across
      // monospace + variable fonts on the same row.
      if (chipTop > firstTop + 2) setOverflowed(true);
    };
    check();

    const ro = new ResizeObserver(check);
    ro.observe(header);
    return () => ro.disconnect();
  }, [entries, layout, overflowed]);

  // Window resize → reset to inline so the next layout pass re-measures.
  // If the viewport grew the chips might now fit; if it shrunk further
  // they'll re-collapse instantly via the useLayoutEffect above.
  useEffect(() => {
    if (layout !== 'auto') return;
    const onResize = () => setOverflowed(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [layout]);

  // Entries changed → reset measurement so a new chip set re-evaluates.
  useEffect(() => {
    if (layout !== 'auto') return;
    setOverflowed(false);
  }, [entries, layout]);

  if (entries.length === 0) return null;

  if (layout !== 'auto' || !overflowed) {
    return (
      <span
        ref={layout === 'auto' ? chipRef : undefined}
        className={cn('inline-flex items-center gap-2', className)}
      >
        {entries.map((entry) => (
          <InlineTickerChip key={entry.symbol} {...entry} />
        ))}
      </span>
    );
  }

  // Overflowed: toggle inline on the header row, chip row pushed onto
  // a new line below via `basis-full` (forces a flex-wrap break).
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'mono tabular text-[9.5px] uppercase tracking-[0.18em]',
          'inline-flex items-center gap-1 cursor-pointer',
          'opacity-70 hover:opacity-100 transition-opacity',
          className,
        )}
      >
        <span>{entries.length} tokens</span>
        <span
          aria-hidden
          className={cn(
            'inline-block transition-transform duration-150',
            open ? 'rotate-180' : 'rotate-0',
          )}
        >
          ▾
        </span>
      </button>
      {open && (
        <span className="basis-full flex flex-wrap items-center gap-2 mt-1 motion-safe:vz-stream-in">
          {entries.map((entry) => (
            <InlineTickerChip key={entry.symbol} {...entry} />
          ))}
        </span>
      )}
    </>
  );
}

function formatInlinePrice(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(6)}`;
}

/* ─────────────────────── inline-coin-icon helper ─────────────────────── */

/**
 * Lookup from a lowercased coin name / symbol / alias → canonical
 * uppercase ticker symbol. Drives `renderTextWithInlineCoinIcons` so
 * "Bitcoin", "BTC", "bitcoin", "Solana", "sol" all resolve to the
 * matching CoinIcon. Built once at module init from TOP_20 plus a
 * curated alias list for the engine's first-class tokens.
 */
const NAME_TO_TICKER: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const coin of TOP_20) {
    m.set(coin.symbol.toLowerCase(), coin.symbol);
    m.set(coin.name.toLowerCase(), coin.symbol);
  }
  const aliases: Record<string, string> = {
    btc: 'BTC',
    bitcoin: 'BTC',
    eth: 'ETH',
    ethereum: 'ETH',
    sol: 'SOL',
    solana: 'SOL',
    // TON → GRAM rebrand (mid-2026). Legacy "TON" / "Toncoin"
    // mentions in user text or i18n copy still resolve to the new
    // GRAM glyph so the rolling examples don't have to be reworded
    // before the brand catches up everywhere.
    ton: 'GRAM',
    toncoin: 'GRAM',
    gram: 'GRAM',
    hype: 'HYPE',
    hyperliquid: 'HYPE',
    pyth: 'PYTH',
    jup: 'JUP',
    jupiter: 'JUP',
  };
  for (const [k, v] of Object.entries(aliases)) m.set(k, v);
  return m;
})();

/** Whole-word, case-insensitive match against every known coin name.
 *  Longer names listed first so "Bitcoin" wins over a hypothetical "Bit"
 *  prefix when both are in the map. */
const COIN_NAME_PATTERN: RegExp = (() => {
  const names = [...NAME_TO_TICKER.keys()].sort(
    (a, b) => b.length - a.length,
  );
  const escaped = names.map((n) =>
    n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'gi');
})();

/**
 * Walk a prose sentence and inject a `<CoinIcon>` directly in front of
 * every recognized coin name or symbol, while preserving the original
 * casing of the surrounding text. "¿Compro Bitcoin esta semana?" →
 * "¿Compro [● Bitcoin] esta semana?" with the icon riding alongside
 * the word it identifies.
 *
 * `skipTickers` skips injection for symbols already represented by a
 * leading visual pill so the same coin doesn't double up (icon chip +
 * inline icon for the same ticker).
 */
export function renderTextWithInlineCoinIcons(
  text: string,
  options: { iconSize?: number; skipTickers?: ReadonlySet<string> } = {},
): ReactNode {
  if (!text) return text;
  const { iconSize = 14, skipTickers } = options;
  const segments: ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  COIN_NAME_PATTERN.lastIndex = 0;
  while ((match = COIN_NAME_PATTERN.exec(text)) !== null) {
    const matched = match[0];
    const ticker =
      NAME_TO_TICKER.get(matched.toLowerCase()) ?? matched.toUpperCase();
    if (skipTickers?.has(ticker)) continue;
    if (match.index > lastIdx) {
      segments.push(text.slice(lastIdx, match.index));
    }
    segments.push(
      <span
        key={`coin-${match.index}-${matched}`}
        className="inline-flex items-center gap-1 align-middle"
      >
        <CoinIcon symbol={ticker} size={iconSize} />
        <span>{matched}</span>
      </span>,
    );
    lastIdx = match.index + matched.length;
  }
  if (segments.length === 0) return text;
  if (lastIdx < text.length) {
    segments.push(text.slice(lastIdx));
  }
  return (
    <>
      {segments.map((seg, i) => (
        <Fragment key={i}>{seg}</Fragment>
      ))}
    </>
  );
}
