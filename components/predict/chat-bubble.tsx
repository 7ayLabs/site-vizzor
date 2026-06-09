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

import type { useChat } from '@ai-sdk/react';
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

export function ChatBubble({ message, streaming = false }: ChatBubbleProps) {
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
        <UserBubble text={text} />
      ) : (
        <AssistantBubble text={text} streaming={streaming} />
      )}
    </div>
  );
}

/* ────────────── user bubble ────────────── */

function UserBubble({ text }: { text: string }) {
  return (
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
  );
}

/* ────────────── assistant bubble ────────────── */

function AssistantBubble({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const lines = formatLines(text);
  const hasContent = lines.length > 0;

  return (
    <div
      className={cn(
        // Quiet surface — translucent fill that lifts a touch on
        // hover so the bubble feels alive without ever showing a hard
        // outline. The asymmetric tl corner mirrors the user side.
        'group relative max-w-[42rem]',
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
    </div>
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
