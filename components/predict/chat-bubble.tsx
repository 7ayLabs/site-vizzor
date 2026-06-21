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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { useChat } from '@ai-sdk/react';
import { Check, Copy, Pencil } from 'lucide-react';
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
   * Localized label for the assistant-bubble Copy affordance.
   * Defaults to "Copy". Hidden until hover/focus.
   */
  copyLabel?: string;
  /**
   * Localized confirmation flashed in place of `copyLabel` for ~1.5s
   * after a successful copy. Defaults to "Copied".
   */
  copiedLabel?: string;
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
}: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const text = message.parts
    .filter((p) => p.type === 'text')
    .map((p) => ('text' in p ? p.text : ''))
    .join('');

  const timestamp = formatTimestamp(undefined);
  const roleLabel = isUser ? 'you' : 'vizzor';

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
          onEdit={onEdit ? () => onEdit(message.id, text) : undefined}
          editLabel={editLabel}
        />
      ) : (
        <AssistantBubble
          text={text}
          streaming={streaming}
          sourcesLabel={sourcesLabel}
          tickerByCoin={tickerByCoin}
          priceCheck={priceCheck}
          copyLabel={copyLabel}
          copiedLabel={copiedLabel}
        />
      )}
    </div>
  );
}

/* ────────────── user bubble ────────────── */

function UserBubble({
  text,
  onEdit,
  editLabel,
}: {
  text: string;
  onEdit?: () => void;
  editLabel: string;
}) {
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
        <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words">
          {text}
        </p>
      </div>
      {onEdit && (
        // Action row under the bubble — mirrors the assistant side's
        // Copy row but right-aligned. Single icon for now; the flex
        // container is the natural mount point for future user-side
        // affordances (resend, branch).
        <div className="flex items-center gap-1 -mt-0.5 pr-1">
          <EditButton onEdit={onEdit} editLabel={editLabel} />
        </div>
      )}
    </div>
  );
}

/**
 * Hover/focus-revealed Edit affordance under user bubbles. Symmetric with
 * the assistant-side CopyButton — same icon-square footprint, same hover
 * background, same `sr-only` accessible label. Activated only on the
 * latest editable user turn (the parent gates which message receives
 * `onEdit`).
 */
function EditButton({
  onEdit,
  editLabel,
}: {
  onEdit: () => void;
  editLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={editLabel}
      title={editLabel}
      className={cn(
        'opacity-0 group-hover/user:opacity-100 focus-visible:opacity-100',
        'transition-opacity duration-150',
        'inline-flex items-center justify-center',
        'h-7 w-7 rounded-md',
        'text-[var(--fg-3)] hover:text-[var(--fg)]',
        'hover:bg-[color-mix(in_oklab,var(--surface)_80%,transparent)]',
      )}
    >
      <span className="sr-only">{editLabel}</span>
      <Pencil className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

/* ────────────── assistant bubble ────────────── */

function AssistantBubble({
  text,
  streaming,
  sourcesLabel,
  tickerByCoin,
  priceCheck,
  copyLabel,
  copiedLabel,
}: {
  text: string;
  streaming: boolean;
  sourcesLabel: string;
  tickerByCoin?: ReadonlyMap<string, number>;
  priceCheck?: { label: string; body: string };
  copyLabel: string;
  copiedLabel: string;
}) {
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
        'transition-colors duration-200',
        'px-4 py-3',
      )}
    >
      <div className="mono tabular text-[12.5px] leading-relaxed text-[var(--fg)] whitespace-pre-wrap break-words">
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

      {sources.length > 0 && !streaming && (
        // Sources panel — sits at the foot of the assistant bubble
        // listing every tool the engine actually invoked for this
        // turn. Transparent so users who don't care can ignore it;
        // the mono chips line up under the prose for a clean fold.
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
    </div>
      {!streaming && hasContent && (
        // Action row sits BELOW the bubble — currently a single Copy icon
        // but the row is the natural mount point for future affordances
        // (regenerate, share, save) so it's already a flex container.
        // Hover-revealed via the named `group/asst` on the outer column.
        <div className="flex items-center gap-1 -mt-0.5 pl-1">
          <CopyButton
            text={text}
            copyLabel={copyLabel}
            copiedLabel={copiedLabel}
          />
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

/* ────────────── copy button ────────────── */

/**
 * Hover/focus-revealed Copy affordance on assistant bubbles. Stays mounted
 * but invisible so it can take keyboard focus via Tab without a layout
 * shift; opacity flips on `group-hover` or focus-visible. After a
 * successful copy, the label briefly swaps to the localized "Copied"
 * confirmation, then restores — the timeout is cleared on unmount so
 * navigating away mid-flash doesn't try to setState on a dead node.
 *
 * Falls back to a document.execCommand path when the secure-context
 * Clipboard API is unavailable (e.g. http://localhost in some browsers
 * without explicit allowlist). On total failure we surface nothing
 * loud — the button just doesn't flash "Copied", which is the right
 * read for a low-stakes interaction.
 */
function CopyButton({
  text,
  copyLabel,
  copiedLabel,
}: {
  text: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!text) return;
    let ok = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      } else if (typeof document !== 'undefined') {
        // Legacy fallback for non-secure contexts. Mount an offscreen
        // textarea, select, execCommand, tear down. Best-effort.
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
    setCopied(true);
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setCopied(false);
      timeoutRef.current = null;
    }, 1500);
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? copiedLabel : copyLabel}
      title={copied ? copiedLabel : copyLabel}
      className={cn(
        // Icon-only square — same hover-reveal behaviour but anchored to
        // the named `group/asst` on the surrounding column instead of
        // the bubble itself (since this row now lives outside it).
        'opacity-0 group-hover/asst:opacity-100 focus-visible:opacity-100',
        'transition-opacity duration-150',
        'inline-flex items-center justify-center',
        'h-7 w-7 rounded-md',
        'text-[var(--fg-3)] hover:text-[var(--fg)]',
        'hover:bg-[color-mix(in_oklab,var(--surface)_80%,transparent)]',
        copied && 'text-[var(--fg)] opacity-100',
      )}
    >
      {/* Live-region announces the change for assistive tech. */}
      <span className="sr-only" aria-live="polite">
        {copied ? copiedLabel : copyLabel}
      </span>
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
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
