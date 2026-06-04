'use client';

/**
 * ChatPanel — on-site Vizzor chat surface.
 *
 * Streams from `/api/predict` using the AI SDK's `useChat` hook. The
 * UI is intentionally minimal: a thread, an input, and nothing else.
 * Visual language matches the rest of the site (mono labels, sharp
 * corners, hairline borders, accent used only on the send button).
 *
 * When the API returns 402 (free quota exhausted), the hook surfaces
 * the error via `status === 'error'` and the parent <PredictRoute>
 * pivots its sidebar to the paywall state. The chat thread stays
 * mounted so the user's transcript isn't lost.
 *
 * Burn-session handoff (Phase 2):
 *   The parent passes the latest `burnSig` (or null) and a callback
 *   `onConsumeBurn`. We mirror `burnSig` into a ref so the chat
 *   transport's `headers` function — created once at mount — always
 *   sees the current value when each fetch fires. After a successful
 *   stream finishes, we clear the sig so a subsequent message
 *   requires a fresh burn.
 */

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import useSWR from 'swr';

interface ChatPanelProps {
  burnSig?: string | null;
  onConsumeBurn?: () => void;
  onQuotaChange?: () => void;
}

interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
  isLive: boolean;
}

const quotaFetcher = (url: string) => fetch(url).then((r) => r.json());

// Build-time inlined; dead-code-eliminated in production builds.
const IS_DEV = process.env.NODE_ENV !== 'production';

export function ChatPanel({
  burnSig,
  onConsumeBurn,
  onQuotaChange,
}: ChatPanelProps) {
  const t = useTranslations('predict');
  const [input, setInput] = useState('');
  const threadRef = useRef<HTMLDivElement | null>(null);

  // Mirror the prop into a ref so the transport's header function (which
  // closes over its initial value) always reads the latest sig.
  const burnSigRef = useRef<string | null>(burnSig ?? null);
  useEffect(() => {
    burnSigRef.current = burnSig ?? null;
  }, [burnSig]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/predict',
        headers: (): Record<string, string> => {
          const sig = burnSigRef.current;
          return sig ? { 'x-vizzor-burn-tx': sig } : {};
        },
      }),
    [],
  );

  const { messages, sendMessage, status, error } = useChat({
    transport,
    onFinish: () => {
      // The burn (if any) has been consumed by the server. Clear so the
      // next message requires a fresh burn, and re-fetch quota for the
      // sidebar.
      if (burnSigRef.current) onConsumeBurn?.();
      onQuotaChange?.();
    },
  });

  // Live quota — shared with <QuotaSidebar> via SWR key dedup, so this
  // doesn't trigger an extra fetch. Used to gate the composer.
  const { data: quota } = useSWR<QuotaState>('/api/quota', quotaFetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
  const exhausted = !!quota?.exhausted;
  // Paid users (with a pending burn sig) bypass the exhausted gate.
  const composerLocked = exhausted && !burnSig;

  // Auto-scroll on each new chunk.
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages]);

  const isStreaming = status === 'streaming' || status === 'submitted';
  const isErrored = status === 'error';

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming || composerLocked) return;
    sendMessage({ text: trimmed });
    setInput('');
  };

  const onInlineReset = async () => {
    const res = await fetch('/api/quota/reset', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (res.ok) {
      // Force the freshest possible state on every consumer — the
      // sidebar, this panel, and any other component watching the
      // cookie. Cheap in dev; never reached in production builds.
      window.location.reload();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Thread */}
      <div
        ref={threadRef}
        className="flex-1 min-h-0 overflow-y-auto px-1"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <EmptyState placeholder={t('emptyState')} />
        ) : (
          <ul className="flex flex-col gap-6 py-4">
            {messages.map((m) => (
              <ChatBubble key={m.id} message={m} />
            ))}
          </ul>
        )}

        {isErrored && error && (
          <div className="mt-4 border border-[var(--border)] bg-[var(--surface)] px-3 py-2 mono tabular text-[11px] uppercase tracking-[0.14em] text-[var(--danger)]">
            {parseErrorMessage(error)}
          </div>
        )}
      </div>

      {/* Exhausted banner — replaces the composer when the user is
          out of free predictions and has no pending burn sig. Surfaces
          a clear next step (reset in dev, Telegram in prod). */}
      {composerLocked && (
        <div
          className="
            mt-4 flex flex-col gap-2
            border border-[var(--border)] bg-[var(--surface)] px-4 py-3
          "
        >
          <p className="mono tabular text-[10.5px] uppercase tracking-[0.16em] text-[var(--accent)]">
            {t('exhaustedBanner.label')}
          </p>
          <p className="text-[12.5px] leading-relaxed text-[var(--fg-2)]">
            {t('exhaustedBanner.body')}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <a
              href="https://t.me/vizzorai_bot"
              target="_blank"
              rel="noopener"
              className="
                mono tabular text-[10.5px] uppercase tracking-[0.16em]
                border border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]
                px-3 py-2 hover:opacity-90 transition-opacity
              "
            >
              {t('exhaustedBanner.telegramCta')}
            </a>
            {IS_DEV && (
              <button
                type="button"
                onClick={onInlineReset}
                className="
                  mono tabular text-[10px] uppercase tracking-[0.16em]
                  text-[var(--fg-3)] hover:text-[var(--fg)]
                  underline-offset-4 hover:underline transition-colors
                "
              >
                {t('exhaustedBanner.resetDev')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Composer */}
      {!composerLocked && (
        <form
          onSubmit={onSubmit}
          className="
            mt-4 flex items-stretch gap-0
            border border-[var(--border)] bg-[var(--surface)]
            focus-within:border-[var(--fg-2)]
            transition-colors
          "
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('inputPlaceholder')}
            disabled={isStreaming}
            aria-label={t('inputPlaceholder')}
            className="
              flex-1 bg-transparent px-4 py-3
              text-[14px] text-[var(--fg)]
              placeholder:text-[var(--fg-3)]
              outline-none disabled:opacity-50
            "
          />
          <button
            type="submit"
            disabled={isStreaming || input.trim().length === 0}
            className="
              mono tabular text-[11px] uppercase tracking-[0.14em]
              border-l border-[var(--border)]
              bg-[var(--accent)] px-5 text-[var(--accent-fg)]
              hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed
              transition-opacity
            "
          >
            {isStreaming ? t('streaming') : t('send')}
          </button>
        </form>
      )}
    </div>
  );
}

function ChatBubble({
  message,
}: {
  message: ReturnType<typeof useChat>['messages'][number];
}) {
  const isUser = message.role === 'user';
  const text = message.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('');

  return (
    <li
      className={`
        flex flex-col gap-1
        ${isUser ? 'items-end' : 'items-start'}
      `}
    >
      <span className="mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
        {isUser ? 'you' : 'vizzor'}
      </span>
      <pre
        className={`
          mono tabular text-[12.5px] leading-relaxed
          whitespace-pre-wrap break-words
          max-w-[42rem] px-3 py-2
          border border-[var(--border)]
          ${isUser ? 'bg-[var(--surface-2)] text-[var(--fg)]' : 'bg-[var(--surface)] text-[var(--fg)]'}
        `}
      >
        {text || (isUser ? '' : '…')}
      </pre>
    </li>
  );
}

function EmptyState({ placeholder }: { placeholder: string }) {
  return (
    <div className="flex h-full min-h-[280px] items-center justify-center px-4">
      <p className="mono tabular text-[11px] uppercase tracking-[0.16em] text-[var(--fg-3)] text-center max-w-[42ch]">
        {placeholder}
      </p>
    </div>
  );
}

function parseErrorMessage(error: Error): string {
  // The AI SDK serializes server error responses as JSON in error.message
  // when the response was not 200 — try to surface a useful line.
  try {
    const parsed = JSON.parse(error.message);
    if (typeof parsed === 'object' && parsed && 'message' in parsed) {
      return String(parsed.message);
    }
  } catch {
    // fallthrough
  }
  return error.message.slice(0, 200);
}
