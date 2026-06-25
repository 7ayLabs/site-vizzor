'use client';

/**
 * ChatBubble — a single message in the thread.
 *
 * Pass 33 — minimalist + fluid:
 *
 *   - User bubble: solid `--fg` fill, inverted text, asymmetric corner
 *     (rounded-tr-md) that points the bubble back at the right column
 *     edge. No border, no glow — pure high-contrast pill.
 *   - Assistant bubble: chromeless by default. A soft `--surface`
 *     fill at low alpha gives it just enough body to read as a card
 *     without competing with the prose. Asymmetric corner (rounded-tl-md)
 *     mirrors the user side. Mono-tabular body kept so receipts and
 *     ledger rows still align.
 *   - Tool annotations get a vertical hairline + uppercase mono label
 *     instead of a colored chip — quieter and on-system.
 *   - Mount: `vz-bubble-in-right` / `vz-bubble-in-left` so each role
 *     slides in from its own side. Reduced-motion users get the
 *     animation collapsed by the global media query in globals.css.
 *   - Streaming pulse: 3 mono dots driven by a CSS keyframe wave,
 *     staggered by 140ms. Replaces the previous `setInterval` ticker
 *     so the animation is GPU-friendly and idle-safe.
 *
 * Engine wiring (`useChat` message parts) is untouched: same `text`
 * parts, same join semantics.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import type { useChat } from '@ai-sdk/react';
import { Check, ChevronDown, ChevronUp, Copy, Pencil, Quote, Share2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useReducedMotionSafe } from '@/lib/motion';

type Message = ReturnType<typeof useChat>['messages'][number];

export interface ChatBubbleProps {
  message: Message;
  /**
   * When true, render the assistant body with a streaming 3-dot pulse
   * appended to whatever text has streamed so far. Parent shell flips
   * this on the last assistant message while the SSE is in flight.
   */
  streaming?: boolean;
  /**
   * When set on a USER bubble, the parent has marked this turn as
   * editable (typically the last user message in the thread). On
   * hover the bubble exposes an Edit affordance; clicking it fires
   * `onEdit(message.id, text)` so the parent can pre-fill the
   * composer and trim the assistant reply for a regenerate flow.
   * Assistant bubbles ignore this prop.
   */
  onEdit?: (id: string, text: string) => void;
  /** Localized label for the edit hover button — defaults to "Edit". */
  editLabel?: string;
  /** Localized heading for the assistant sources panel. */
  sourcesLabel?: string;
  /**
   * Map of `SYMBOL → live price` for the spot-price cross-check. When
   * set, the assistant bubble parses any `{SYMBOL} Price: $X.XX` line
   * the engine emits and warns the user if it disagrees with the
   * live ticker by more than 2%. Defends against engine-side LLM
   * hallucinations without claiming to fix the upstream root cause.
   */
  tickerByCoin?: ReadonlyMap<string, number>;
  /** Localized strings for the price-mismatch banner. */
  priceCheck?: {
    /** Banner heading (e.g. "Precio dudoso") */
    label: string;
    /**
     * Templated body — receives `{symbol}`, `{quoted}`, `{live}`,
     * `{delta}` placeholders that the bubble fills in.
     */
    body: string;
  };
  /**
   * Localized label for the Copy affordance (both roles).
   * Defaults to "Copy". Hidden until hover/focus.
   */
  copyLabel?: string;
  /**
   * Localized confirmation flashed in place of `copyLabel` for ~1.5s
   * after a successful copy. Defaults to "Copied".
   */
  copiedLabel?: string;
  /**
   * Quote action — when fired, the parent prepends `> {text}\n\n` to
   * the composer and focuses it. Receives the bubble's plain-text
   * body. Available on both user and assistant bubbles.
   */
  onQuote?: (text: string) => void;
  /** Localized label for the Quote affordance. Defaults to "Quote". */
  quoteLabel?: string;
  /** Localized confirmation flashed after a successful quote action. */
  quotedLabel?: string;
  /**
   * Share action — receives the message id. Parent composes the
   * conversation-anchored deep link and copies it to the clipboard.
   * Available on both user and assistant bubbles. Returns optional
   * promise so the button can wait for confirmation before flashing.
   */
  onShare?: (messageId: string) => void | Promise<void>;
  /** Localized label for the Share affordance. */
  shareLabel?: string;
  /** Localized confirmation flashed after a successful share action. */
  sharedLabel?: string;
  /** Localized label for the per-bubble compact toggle (assistant
   *  bubbles only). When clicked, the assistant bubble collapses to
   *  a tighter density — text size + padding shrink. State is LOCAL
   *  per bubble so users can compact long answers individually. */
  compactLabel?: string;
  /** Localized label flashed when the bubble is in the compact state. */
  compactedLabel?: string;
}

/**
 * Recognize Vizzor's tool-call annotation format. The engine emits
 * tool_use events as inlined text deltas like:
 *
 *    [tool:price symbol=BTC]
 *    [run: chronovisor]
 *
 * Either shape gets pulled out and rendered with a quiet uppercase
 * label and a hairline left bar so it reads as a sub-step of the
 * assistant's reasoning, not a header.
 */
const TOOL_LINE_RE = /^\s*\[(?:tool|run)[:\s]/;

interface FormattedLine {
  kind: 'text' | 'tool';
  content: string;
}

function formatLines(text: string): readonly FormattedLine[] {
  if (!text) return [];
  return text.split('\n').map<FormattedLine>((line) => {
    if (TOOL_LINE_RE.test(line)) {
      return { kind: 'tool', content: line.trim() };
    }
    return { kind: 'text', content: line };
  });
}

function formatTimestamp(ts: number | undefined): string {
  const date = ts ? new Date(ts) : new Date();
  return date
    .toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    .replace(/\s/g, '');
}

export function ChatBubble({
  message,
  streaming = false,
  onEdit,
  editLabel = 'Edit',
  sourcesLabel = 'Sources',
  tickerByCoin,
  priceCheck,
  copyLabel = 'Copy',
  copiedLabel = 'Copied',
  onQuote,
  quoteLabel = 'Quote',
  quotedLabel = 'Quoted',
  onShare,
  shareLabel = 'Share',
  sharedLabel = 'Shared',
  compactLabel = 'Compact',
  compactedLabel = 'Compacted',
}: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const text = message.parts
    .filter((p) => p.type === 'text')
    .map((p) => ('text' in p ? p.text : ''))
    .join('');

  const timestamp = formatTimestamp(undefined);
  const roleLabel = isUser ? 'you' : 'vizzor';

  const actionLabels = {
    copyLabel,
    copiedLabel,
    quoteLabel,
    quotedLabel,
    shareLabel,
    sharedLabel,
    compactLabel,
    compactedLabel,
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5',
        isUser ? 'items-end vz-bubble-in-right' : 'items-start vz-bubble-in-left',
      )}
    >
      <div
        className={cn(
          'mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]',
          'flex items-center gap-2',
        )}
      >
        <span>{roleLabel}</span>
        <span aria-hidden className="text-[var(--fg-3)]/60">·</span>
        <span aria-label={`sent ${timestamp}`}>{timestamp}</span>
      </div>

      {isUser ? (
        <UserBubble
          text={text}
          messageId={message.id}
          onEdit={onEdit ? () => onEdit(message.id, text) : undefined}
          editLabel={editLabel}
          onQuote={onQuote}
          onShare={onShare}
          actionLabels={actionLabels}
        />
      ) : (
        <AssistantBubble
          text={text}
          messageId={message.id}
          streaming={streaming}
          sourcesLabel={sourcesLabel}
          tickerByCoin={tickerByCoin}
          priceCheck={priceCheck}
          onQuote={onQuote}
          onShare={onShare}
          actionLabels={actionLabels}
        />
      )}
    </div>
  );
}

/* ────────────── shared action types ────────────── */

interface ActionLabels {
  copyLabel: string;
  copiedLabel: string;
  quoteLabel: string;
  quotedLabel: string;
  shareLabel: string;
  sharedLabel: string;
  compactLabel: string;
  compactedLabel: string;
}

/* ────────────── user bubble ────────────── */

function UserBubble({
  text,
  messageId,
  onEdit,
  editLabel,
  onQuote,
  onShare,
  actionLabels,
}: {
  text: string;
  messageId: string;
  onEdit?: () => void;
  editLabel: string;
  onQuote?: (text: string) => void;
  onShare?: (messageId: string) => void | Promise<void>;
  actionLabels: ActionLabels;
}) {
  // The row is rendered whenever ANY action is wired — Edit can be
  // gated to the latest editable turn (parent decides) while Copy /
  // Quote / Share are universal once their callbacks are bound.
  const hasActions = Boolean(onEdit || onQuote || onShare) || text.length > 0;

  return (
    // Named group covers BOTH the bubble and the action row underneath.
    // items-end keeps everything right-aligned with the bubble column.
    <div className="flex flex-col items-end gap-2 group/user">
      <div
        className={cn(
          'max-w-[42rem] px-4 py-2.5',
          // Asymmetric corner: tr is tighter so the bubble feels anchored
          // to the right column edge. No border, no shadow — solid fill
          // is the only visual structure.
          'rounded-2xl rounded-tr-md',
          'bg-[var(--fg)] text-[var(--bg)]',
          'transition-colors duration-150',
        )}
      >
        <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words">
          {text}
        </p>
      </div>
      {hasActions && (
        // Action row — Edit (when wired), Copy, Quote, Share. Hover-
        // revealed via the named `group/user` on the outer column.
        <div className="flex items-center gap-0.5 -mt-0.5 pr-1">
          {onEdit && (
            <BubbleActionButton
              groupName="user"
              icon={Pencil}
              label={editLabel}
              onActivate={onEdit}
            />
          )}
          <CopyAction text={text} groupName="user" labels={actionLabels} />
          {onQuote && (
            <QuoteAction text={text} onQuote={onQuote} groupName="user" labels={actionLabels} />
          )}
          {onShare && (
            <ShareAction
              messageId={messageId}
              onShare={onShare}
              groupName="user"
              labels={actionLabels}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────── assistant bubble ────────────── */

function AssistantBubble({
  text,
  messageId,
  streaming,
  sourcesLabel,
  tickerByCoin,
  priceCheck,
  onQuote,
  onShare,
  actionLabels,
}: {
  text: string;
  messageId: string;
  streaming: boolean;
  sourcesLabel: string;
  tickerByCoin?: ReadonlyMap<string, number>;
  priceCheck?: { label: string; body: string };
  onQuote?: (text: string) => void;
  onShare?: (messageId: string) => void | Promise<void>;
  actionLabels: ActionLabels;
}) {
  // Per-bubble compact toggle — each assistant answer can collapse to
  // tighter density independently. Local state (no parent prop, no
  // localStorage) so the compaction is scoped to the message being
  // read. Default is expanded; user opts in per bubble.
  const [compact, setCompact] = useState(false);
  const lines = formatLines(text);
  const hasContent = lines.length > 0;
  // Gather unique tool names from inline `[tool:…]` / `[run:…]` markers
  // the engine emits during streaming. These are the same markers
  // ToolLine renders inline; collecting them lets us also expose a
  // bottom-of-bubble Sources strip — the user can scan WHAT the engine
  // queried (price, derivs, whales, …) without re-reading the prose.
  const sources = collectSources(lines);
  // Cross-check any "{SYMBOL} Price: $X.XX" lines against the live
  // ticker. Only runs once streaming is complete — mid-stream the
  // numbers can be partial and trigger false positives.
  const mismatches = useMemo<readonly PriceMismatch[]>(() => {
    if (streaming) return [];
    if (!tickerByCoin || tickerByCoin.size === 0) return [];
    return findPriceMismatches(text, tickerByCoin);
  }, [text, tickerByCoin, streaming]);

  return (
    // Named group covers BOTH the bubble and the action row underneath, so
    // hovering anywhere over the assistant turn reveals the icon row.
    <div className="flex flex-col gap-2 max-w-[42rem] group/asst">
      {mismatches.length > 0 && priceCheck && (
        <PriceMismatchBanner
          mismatches={mismatches}
          label={priceCheck.label}
          template={priceCheck.body}
        />
      )}
    <div
      className={cn(
        // Quiet surface — translucent fill that lifts a touch on
        // hover so the bubble feels alive without ever showing a hard
        // outline. The asymmetric tl corner mirrors the user side.
        'relative',
        'rounded-2xl rounded-tl-md',
        'bg-[color-mix(in_oklab,var(--surface)_55%,transparent)]',
        'hover:bg-[color-mix(in_oklab,var(--surface)_80%,transparent)]',
        'transition-[background-color,padding] duration-200',
        // Compact halves the vertical padding and tightens the
        // horizontal pad. The big win is the max-height + internal
        // scroll on the body container below, which lets a 2000-word
        // answer fit in ~220px so the user doesn't have to scroll
        // the page to reach the next bubble.
        compact ? 'px-3 py-1.5' : 'px-4 py-3',
      )}
    >
      <div
        className={cn(
          // Body container — sans by default (matches home-page card
          // descriptions). Individual lines that match the tool-
          // annotation regex switch to mono via ToolLine. Mono lives
          // ONLY on instrument readouts; prose reads as prose. Text
          // size + leading stay CONSTANT in both modes — compact
          // shrinks the bubble's CHROME, never the reading
          // vocabulary. Long answers in compact mode become scrollable
          // INSIDE the bubble (max-h + overflow-y) so the page itself
          // stops growing.
          'text-[13.5px] leading-relaxed',
          'text-[var(--fg)] whitespace-pre-wrap break-words',
          compact && 'max-h-[200px] overflow-y-auto pr-1 vz-compact-scroll',
        )}
      >
        {hasContent ? (
          lines.map((line, idx) => {
            const isLast = idx === lines.length - 1;
            if (line.kind === 'tool') {
              return (
                <ToolLine key={idx} raw={line.content} />
              );
            }
            return (
              <span key={idx}>
                {line.content}
                {isLast && streaming && <StreamingDots inline />}
                {!isLast && '\n'}
              </span>
            );
          })
        ) : (
          <StreamingDots />
        )}
      </div>

      {sources.length > 0 && !streaming && !compact && (
        // Sources panel — sits at the foot of the assistant bubble
        // listing every tool the engine actually invoked for this
        // turn. Transparent so users who don't care can ignore it;
        // the mono chips line up under the prose for a clean fold.
        // Hidden when compact to maximize bubble shrinkage.
        <div className="mt-3 pt-2.5 border-t border-[var(--border)]/60">
          <p className="mono tabular text-[9.5px] uppercase tracking-[0.2em] font-semibold text-[var(--fg-3)] mb-1.5">
            {sourcesLabel}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {sources.map((s) => (
              <li
                key={s}
                className={cn(
                  'mono tabular text-[10.5px]',
                  'px-1.5 h-[18px] inline-flex items-center',
                  'rounded-md border border-[var(--border)]',
                  'text-[var(--fg-2)]',
                )}
              >
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Compact toggle — a tiny arrow-only icon button at the lower
          edge of the bubble. No text, no chip chrome: just a chevron
          pointing UP when expanded (click to collapse) and DOWN when
          compact (click to expand). Always visible so the collapse
          affordance is discoverable at a glance. */}
      {!streaming && hasContent && (
        <div
          className={cn(
            'flex items-center justify-center',
            compact ? 'mt-1' : 'mt-2',
          )}
        >
          <BubbleCompactTag
            compact={compact}
            onToggle={() => setCompact((v) => !v)}
            label={compact ? actionLabels.compactedLabel : actionLabels.compactLabel}
          />
        </div>
      )}
      {/* Streaming-continues indicator — a downward chevron that bounces
          gently at the foot of the bubble while the SSE is in flight.
          Reads as "the response continues below" so the user knows more
          text is on its way and the bubble height will keep growing. */}
      {streaming && hasContent && (
        <div className="mt-2 flex items-center justify-center" aria-hidden>
          <StreamingContinuesArrow />
        </div>
      )}
    </div>
      {!streaming && hasContent && (
        // Action row sits BELOW the bubble — Copy, Quote, Share.
        // Hover-revealed via the named `group/asst` on the outer column.
        <div className="flex items-center gap-0.5 -mt-0.5 pl-1">
          <CopyAction text={text} groupName="asst" labels={actionLabels} />
          {onQuote && (
            <QuoteAction
              text={text}
              onQuote={onQuote}
              groupName="asst"
              labels={actionLabels}
            />
          )}
          {onShare && (
            <ShareAction
              messageId={messageId}
              onShare={onShare}
              groupName="asst"
              labels={actionLabels}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────── price cross-check ────────────── */

const PRICE_MISMATCH_THRESHOLD = 0.02;
// Engine emits "{SYMBOL} Price: $X.XX" — also tolerate Spanish "Precio"
// and a few format quirks (no $, comma thousands, optional decimal).
const PRICE_LINE_RE =
  /\b([A-Z]{2,6})\s+(?:Price|Precio)\s*[:=]?\s*\$?\s*([\d,]+(?:\.\d+)?)/gi;

interface PriceMismatch {
  symbol: string;
  responsePrice: number;
  tickerPrice: number;
  /** Signed fractional delta — `+0.11` means engine quoted 11% above live. */
  deltaPct: number;
}

function findPriceMismatches(
  text: string,
  tickerByCoin: ReadonlyMap<string, number>,
): readonly PriceMismatch[] {
  if (!text) return [];
  const out: PriceMismatch[] = [];
  const seen = new Set<string>();
  PRICE_LINE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PRICE_LINE_RE.exec(text)) !== null) {
    const symbol = (match[1] ?? '').toUpperCase();
    const raw = (match[2] ?? '').replace(/,/g, '');
    const responsePrice = Number.parseFloat(raw);
    if (!symbol || !Number.isFinite(responsePrice)) continue;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    const tickerPrice = tickerByCoin.get(symbol);
    if (!tickerPrice) continue;
    const deltaPct = (responsePrice - tickerPrice) / tickerPrice;
    if (Math.abs(deltaPct) <= PRICE_MISMATCH_THRESHOLD) continue;
    out.push({ symbol, responsePrice, tickerPrice, deltaPct });
  }
  return out;
}

function formatUsd(n: number): string {
  if (n < 1) return `$${n.toFixed(4)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function formatSignedPct(d: number): string {
  const pct = d * 100;
  const sign = pct >= 0 ? '+' : '−';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

function fillTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  // `%name%` delimiter — chosen because next-intl / ICU MessageFormat
  // reserves `{name}` as a placeholder, and if the call site doesn't
  // pass matching `values` next-intl silently falls back to the raw
  // key path. `%name%` is invisible to the i18n parser so the template
  // survives intact down to this substitution.
  return template.replace(/%(\w+)%/g, (_, key) => vars[key] ?? `%${key}%`);
}

/**
 * Subtle warning strip mounted ABOVE the assistant bubble whenever the
 * engine quoted a spot price that disagrees with the live ticker by
 * more than 2%. Reads as "trust the ticker, not the model on this
 * one" — not an apology, just transparency. Multiple mismatches stack.
 */
function PriceMismatchBanner({
  mismatches,
  label,
  template,
}: {
  mismatches: readonly PriceMismatch[];
  label: string;
  template: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 px-3 py-2',
        'rounded-md border border-dashed border-[var(--warning,var(--danger))]/70',
        'bg-[color-mix(in_oklab,var(--warning,var(--danger))_8%,transparent)]',
      )}
    >
      <span
        aria-hidden
        className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--warning,var(--danger))] shrink-0"
      />
      <div className="min-w-0 flex flex-col gap-1">
        <p className="mono tabular text-[9.5px] uppercase tracking-[0.16em] font-semibold text-[var(--fg)]">
          {label}
        </p>
        <ul className="flex flex-col gap-0.5">
          {mismatches.map((m) => (
            <li
              key={m.symbol}
              className="text-[11.5px] leading-snug text-[var(--fg-2)]"
            >
              {fillTemplate(template, {
                symbol: m.symbol,
                quoted: formatUsd(m.responsePrice),
                live: formatUsd(m.tickerPrice),
                delta: formatSignedPct(m.deltaPct),
              })}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Pulls a deduped, ordered list of source identifiers out of the
 * already-classified line array. We surface them as plain mono chips —
 * the goal is "what data did the engine touch", not a clickable
 * citation system (no permalink schema yet).
 */
function collectSources(lines: readonly FormattedLine[]): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.kind !== 'tool') continue;
    const match = line.content.match(/\[(?:tool|run)[:\s]+([a-zA-Z0-9_-]+)/);
    const name = match && match[1];
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/* ────────────── per-bubble compact tag ────────────── */

/**
 * BubbleCompactTag — an arrow-only icon button at the lower edge of
 * the assistant bubble. No text, no chip chrome. The chevron flips
 * direction to encode state:
 *
 *   - Expanded (compact=false) → ChevronUp. Click pulls the bubble
 *     UPWARD into compact form.
 *   - Compact (compact=true)  → ChevronDown. Click drops the bubble
 *     back DOWN into the full expanded form.
 *
 * Label is still wired into aria-label + title so screen readers and
 * tooltips retain the semantic ("Compact" / "Compacted").
 */
function BubbleCompactTag({
  compact,
  onToggle,
  label,
}: {
  compact: boolean;
  onToggle: () => void;
  label: string;
}) {
  const Icon = compact ? ChevronDown : ChevronUp;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={compact}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center',
        'h-6 w-6 rounded-full',
        'text-[var(--fg-3)] hover:text-[var(--fg)]',
        'hover:bg-[var(--surface-2)]',
        'transition-colors',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

/**
 * StreamingContinuesArrow — a downward chevron rendered at the foot
 * of the assistant bubble while a response is still streaming in. The
 * arrow drifts gently down-and-back-up to telegraph "the response
 * continues below". Under reduced-motion it stays static (the icon
 * alone still carries the meaning).
 */
function StreamingContinuesArrow() {
  const reduced = useReducedMotionSafe();
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center',
        'h-6 w-6 rounded-full text-[var(--fg-3)]',
        !reduced && 'motion-safe:animate-bounce',
      )}
    >
      <ChevronDown className="h-3.5 w-3.5" aria-hidden />
    </span>
  );
}

/* ────────────── action toolbar ────────────── */

type LucideIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

interface BubbleActionButtonProps {
  /** `user` or `asst` — drives which named group governs hover reveal. */
  groupName: 'user' | 'asst';
  icon: LucideIcon;
  label: string;
  onActivate: () => void;
  /** When set, the icon swaps to the Check glyph for `flashMs` ms and
   *  the aria-label swaps to `flashLabel`. */
  flashLabel?: string;
  flashed?: boolean;
}

/**
 * Shared visual+behavior shell for every bubble action button.
 *
 * Hover-reveal is parameterized by `groupName` so the same component
 * can mount under the `group/user` (right-aligned, items-end) and
 * `group/asst` (left-aligned, items-start) action rows. Without the
 * parameter we'd need per-role copies or a runtime branch that
 * Tailwind can't statically extract — so we accept two literal class
 * strings and pick at compile time.
 *
 * Focus behaviour: the button stays mounted but invisible (opacity 0).
 * On focus-visible the opacity flips to 1 so keyboard users can tab
 * through without losing the affordance. Same applies on group hover.
 */
function BubbleActionButton({
  groupName,
  icon: Icon,
  label,
  onActivate,
  flashLabel,
  flashed = false,
}: BubbleActionButtonProps) {
  const displayLabel = flashed && flashLabel ? flashLabel : label;
  // Pre-baked hover-reveal classes for each named group. Tailwind needs
  // these as literals so JIT can pick them up.
  const hoverClass =
    groupName === 'user'
      ? 'opacity-0 group-hover/user:opacity-100 focus-visible:opacity-100'
      : 'opacity-0 group-hover/asst:opacity-100 focus-visible:opacity-100';

  return (
    <button
      type="button"
      onClick={onActivate}
      aria-label={displayLabel}
      title={displayLabel}
      className={cn(
        hoverClass,
        'transition-opacity duration-150',
        'inline-flex items-center justify-center',
        'h-7 w-7 rounded-md',
        'text-[var(--fg-3)] hover:text-[var(--fg)]',
        'hover:bg-[color-mix(in_oklab,var(--surface)_80%,transparent)]',
        flashed && 'text-[var(--fg)] opacity-100',
      )}
    >
      <span className="sr-only" aria-live="polite">
        {displayLabel}
      </span>
      {flashed ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Icon className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
  );
}

/**
 * useFlash — generic 1.5s flash-on-success state for action buttons.
 * Cancels the timeout on unmount so navigating away mid-flash never
 * setStates on a dead component.
 */
function useFlash(): {
  flashed: boolean;
  flash: () => void;
} {
  const [flashed, setFlashed] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const flash = useCallback(() => {
    setFlashed(true);
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setFlashed(false);
      timeoutRef.current = null;
    }, 1500);
  }, []);

  return { flashed, flash };
}

/**
 * Copy the bubble's plain text. Same dual-path as the prior CopyButton:
 * native Clipboard API first, document.execCommand fallback for
 * insecure-context dev. On any success, flash "Copied" for 1.5 s.
 */
function CopyAction({
  text,
  groupName,
  labels,
}: {
  text: string;
  groupName: 'user' | 'asst';
  labels: ActionLabels;
}) {
  const { flashed, flash } = useFlash();
  const handle = useCallback(async () => {
    if (!text) return;
    let ok = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      } else if (typeof document !== 'undefined') {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch {
      ok = false;
    }
    if (!ok) return;
    flash();
  }, [text, flash]);

  return (
    <BubbleActionButton
      groupName={groupName}
      icon={Copy}
      label={labels.copyLabel}
      onActivate={() => void handle()}
      flashLabel={labels.copiedLabel}
      flashed={flashed}
    />
  );
}

/**
 * Fire the `onQuote` callback with the bubble's text. The parent
 * (predict-shell) prepends `> {text}\n\n` to the composer and focuses
 * the textarea — that focus shift IS the primary feedback, the flash
 * is just a confirmation that the click was registered.
 */
function QuoteAction({
  text,
  onQuote,
  groupName,
  labels,
}: {
  text: string;
  onQuote: (text: string) => void;
  groupName: 'user' | 'asst';
  labels: ActionLabels;
}) {
  const { flashed, flash } = useFlash();
  const handle = useCallback(() => {
    if (!text) return;
    onQuote(text);
    flash();
  }, [text, onQuote, flash]);

  return (
    <BubbleActionButton
      groupName={groupName}
      icon={Quote}
      label={labels.quoteLabel}
      onActivate={handle}
      flashLabel={labels.quotedLabel}
      flashed={flashed}
    />
  );
}

/**
 * Fire the `onShare` callback with the message id. The parent composes
 * the conversation-anchored deep link, copies it to the clipboard, and
 * shows a sonner toast for the visible feedback. The local flash just
 * confirms the click landed.
 */
function ShareAction({
  messageId,
  onShare,
  groupName,
  labels,
}: {
  messageId: string;
  onShare: (messageId: string) => void | Promise<void>;
  groupName: 'user' | 'asst';
  labels: ActionLabels;
}) {
  const { flashed, flash } = useFlash();
  const handle = useCallback(async () => {
    try {
      await onShare(messageId);
      flash();
    } catch {
      // Parent toast carries the error message; the button just doesn't
      // flash, which reads correctly as "didn't work, try again".
    }
  }, [messageId, onShare, flash]);

  return (
    <BubbleActionButton
      groupName={groupName}
      icon={Share2}
      label={labels.shareLabel}
      onActivate={() => void handle()}
      flashLabel={labels.sharedLabel}
      flashed={flashed}
    />
  );
}

/* ────────────── tool-line ────────────── */

function ToolLine({ raw }: { raw: string }) {
  const label = extractToolLabel(raw);
  const rest = stripToolWrap(raw);
  return (
    <div
      className={cn(
        // Vertical hairline + indent — reads as a quiet sub-step of
        // the assistant's reasoning, not a header chip. Mono tabular
        // so it lines up with surrounding receipt rows.
        'my-1 flex items-baseline gap-2',
        'border-l border-[var(--border-hi)] pl-2.5',
        'text-[11.5px]',
      )}
    >
      <span
        className={cn(
          'mono tabular text-[10px] uppercase tracking-[0.16em] font-semibold shrink-0',
          'text-[var(--fg-2)]',
        )}
        aria-label="tool call"
      >
        {label}
      </span>
      {rest && (
        <span className="text-[var(--fg-2)]">{rest}</span>
      )}
    </div>
  );
}

function extractToolLabel(line: string): string {
  // [tool:price ...] → run: price
  // [run: chronovisor] → run: chronovisor
  const match = line.match(/\[(?:tool|run)[:\s]+([a-zA-Z0-9_-]+)/);
  const name = match && match[1] ? match[1] : 'tool';
  return `run: ${name}`;
}

function stripToolWrap(line: string): string {
  // Pull out any args after the tool name for context, drop the brackets.
  const match = line.match(/\[(?:tool|run)[:\s]+[a-zA-Z0-9_-]+\s*(.*?)\]/);
  const rest = match && match[1] ? match[1].trim() : '';
  return rest;
}

/* ────────────── streaming dots ────────────── */

/**
 * Three mono dots driven by a continuous CSS keyframe (vz-dot-bounce)
 * with a 140ms stagger. No JS timer, no React state — the animation
 * runs entirely on the compositor, idles cheaply, and collapses
 * automatically under reduced-motion via the global media query.
 */
function StreamingDots({ inline = false }: { inline?: boolean }) {
  const reduced = useReducedMotionSafe();

  if (reduced) {
    return (
      <span
        aria-label="streaming"
        role="status"
        className={cn(
          'mono tabular text-[var(--fg-2)] select-none',
          inline ? 'ml-1' : '',
        )}
      >
        …
      </span>
    );
  }

  return (
    <span
      aria-label="streaming"
      role="status"
      className={cn(
        'mono tabular select-none inline-flex items-baseline gap-[3px]',
        'text-[var(--fg-2)]',
        inline ? 'ml-1.5' : '',
      )}
    >
      <span aria-hidden className="vz-dot-bounce">·</span>
      <span aria-hidden className="vz-dot-bounce vz-dot-bounce-d2">·</span>
      <span aria-hidden className="vz-dot-bounce vz-dot-bounce-d3">·</span>
    </span>
  );
}
