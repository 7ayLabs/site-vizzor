'use client';

/**
 * ChatBubble — a single message in the thread.
 *
 * Terminal aesthetic redesign (Phase 2B):
 *
 *   - User bubble: small mono eyebrow timestamp, transparent fill,
 *     hairline mint border (`--border-hi` blended toward `--accent`),
 *     rounded body text in the sans stack.
 *   - Assistant bubble: glass card styled like `<DataTile variant="terminal">` —
 *     accent corner brackets, `--border-hi` hairline, mono-tabular body
 *     that preserves the receipt's column alignment. Tool-call
 *     annotations (`[tool:name ...]`, `[run: tool_name]`) get a gold mono
 *     prefix and are split out to their own line.
 *   - Streaming state: 3-dot mono pulse (`.`, `..`, `...`) gated by
 *     `useReducedMotionSafe()` — reduced-motion users see a static `...`.
 *
 * Engine wiring (`useChat` message parts) is untouched: same `text` parts,
 * same join semantics.
 */

import { useEffect, useState } from 'react';
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
 * Either shape gets pulled out and rendered with a gold mono prefix.
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

  // Timestamp: prefer the message's createdAt if the SDK ever exposes one,
  // otherwise the parent-provided current time on first render.
  const timestamp = formatTimestamp(undefined);
  const roleLabel = isUser ? 'you' : 'vizzor';

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5',
        isUser ? 'items-end' : 'items-start',
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
        'max-w-[42rem] px-4 py-2.5 rounded-lg',
        'bg-transparent text-[var(--fg)]',
        'border',
      )}
      style={{
        // 1px mint border at low alpha — falls back through --border-hi
        // for reduced-contrast themes via color-mix.
        borderColor:
          'color-mix(in oklab, var(--accent) 35%, var(--border-hi) 65%)',
      }}
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
        // DataTile terminal-style card: vt-bracket corners + --border-hi.
        'vt-bracket relative max-w-[42rem]',
        'rounded-lg bg-[var(--surface)]',
        'border border-[var(--border-hi)]',
        'px-5 py-4',
      )}
    >
      <div className="mono tabular text-[12.5px] leading-relaxed text-[var(--fg)] whitespace-pre-wrap break-words">
        {hasContent ? (
          lines.map((line, idx) => {
            const isLast = idx === lines.length - 1;
            if (line.kind === 'tool') {
              return (
                <div
                  key={idx}
                  className="flex items-baseline gap-2 py-0.5"
                >
                  <span
                    className="mono tabular text-[10px] uppercase tracking-[0.16em] font-semibold text-[var(--gold)] shrink-0"
                    aria-label="tool call"
                  >
                    {extractToolLabel(line.content)}
                  </span>
                  <span className="text-[var(--fg-2)] text-[11.5px]">
                    {stripToolWrap(line.content)}
                  </span>
                </div>
              );
            }
            return (
              <span key={idx}>
                {line.content}
                {isLast && streaming && (
                  <StreamingDots inline />
                )}
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

/* ────────────── tool-line helpers ────────────── */

function extractToolLabel(line: string): string {
  // [tool:price ...] → [run: price]
  // [run: chronovisor] → [run: chronovisor]
  const match = line.match(/\[(?:tool|run)[:\s]+([a-zA-Z0-9_-]+)/);
  const name = match && match[1] ? match[1] : 'tool';
  return `[run: ${name}]`;
}

function stripToolWrap(line: string): string {
  // Pull out any args after the tool name for context, drop the brackets.
  const match = line.match(/\[(?:tool|run)[:\s]+[a-zA-Z0-9_-]+\s*(.*?)\]/);
  const rest = match && match[1] ? match[1].trim() : '';
  return rest;
}

/* ────────────── streaming dots ────────────── */

function StreamingDots({ inline = false }: { inline?: boolean }) {
  const reduced = useReducedMotionSafe();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => {
      setTick((t) => (t + 1) % 3);
    }, 380);
    return () => window.clearInterval(id);
  }, [reduced]);

  const frame = reduced ? '...' : ['.', '..', '...'][tick];
  return (
    <span
      aria-label="streaming"
      role="status"
      className={cn(
        'mono tabular text-[var(--accent)] select-none',
        inline ? 'ml-1' : '',
      )}
    >
      {frame}
    </span>
  );
}
