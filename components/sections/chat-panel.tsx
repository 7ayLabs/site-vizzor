'use client';

/**
 * ChatPanel — homepage on-site Vizzor chat surface.
 *
 * Streams from `/api/predict` using the AI SDK's `useChat` hook. The
 * UI is intentionally minimal: a thread, an input, and nothing else.
 *
 * Phase 2B visual refresh:
 *   - Wrapped in a terminal-style panel: `--border-hi` hairline, accent
 *     corner brackets via `.vt-bracket`, decorative `<ScanlineOverlay>`
 *     tint behind the thread so the panel reads as a Bloomberg screen.
 *   - Composer adopts the same terminal prompt style as the /predict
 *     shell: `>` accent glyph, mono-tabular input, focus glow.
 *   - Bubbles re-use the new <ChatBubble> primitive from
 *     `components/predict/chat-bubble.tsx` so the homepage and the
 *     /predict route stay visually coherent.
 *
 * Data wiring is byte-identical:
 *   - SWR key `/api/quota` is shared with QuotaSidebar.
 *   - The `useChat` transport keeps the burnSig header injection ref.
 *   - `onConsumeBurn` + `onQuotaChange` callbacks fire on the same
 *     boundary as before (post-finish).
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
import { Send } from 'lucide-react';
import { ChatBubble } from '@/components/predict/chat-bubble';
import { ScanlineOverlay } from '@/components/ui/scanline-overlay';
import { useReducedMotionSafe } from '@/lib/motion';
import { cn } from '@/lib/utils';

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

const quotaFetcher = (url: string): Promise<QuotaState> =>
  fetch(url).then((r) => r.json() as Promise<QuotaState>);

const IS_DEV = process.env.NODE_ENV !== 'production';

export function ChatPanel({
  burnSig,
  onConsumeBurn,
  onQuotaChange,
}: ChatPanelProps) {
  const t = useTranslations('predict');
  const reduced = useReducedMotionSafe();
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
      if (burnSigRef.current) onConsumeBurn?.();
      onQuotaChange?.();
    },
  });

  // Live quota — shared with <QuotaSidebar> via SWR key dedup.
  const { data: quota } = useSWR<QuotaState>('/api/quota', quotaFetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
  const exhausted = !!quota?.exhausted;
  const composerLocked = exhausted && !burnSig;

  // Auto-scroll on each new chunk.
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages]);

  const isStreaming = status === 'streaming' || status === 'submitted';
  const isErrored = status === 'error';

  const lastAssistantId = useMemo<string | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.role !== 'user') return m.id;
    }
    return null;
  }, [messages]);

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming || composerLocked) return;
    sendMessage({ text: trimmed });
    setInput('');
  };

  const onInlineReset = async (): Promise<void> => {
    const res = await fetch('/api/quota/reset', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (res.ok) {
      window.location.reload();
    }
  };

  return (
    <div
      className={cn(
        'vt-bracket relative flex h-full min-h-0 flex-col',
        'rounded-lg border border-[var(--border-hi)]',
        'bg-[var(--surface)]',
        'overflow-hidden',
      )}
    >
      <ScanlineOverlay opacity={0.22} />

      <div className="relative z-10 flex h-full min-h-0 flex-col p-3 sm:p-4">
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
                <li
                  key={m.id}
                  className={cn(
                    'flex',
                    m.role === 'user' ? 'justify-end' : 'justify-start',
                  )}
                >
                  <ChatBubble
                    message={m}
                    streaming={isStreaming && m.id === lastAssistantId}
                  />
                </li>
              ))}
            </ul>
          )}

          {isErrored && error && (
            <div
              className={cn(
                'mt-4 rounded',
                'border border-[var(--border-hi)] bg-[var(--surface)]',
                'px-3 py-2 mono tabular text-[11px] uppercase tracking-[0.14em]',
                'text-[var(--danger)]',
              )}
            >
              {parseErrorMessage(error)}
            </div>
          )}
        </div>

        {composerLocked && <ExhaustedBlock onReset={onInlineReset} />}

        {!composerLocked && (
          <form
            onSubmit={onSubmit}
            className={cn(
              'mt-4 flex items-center gap-2',
              'rounded-lg border border-[var(--border-hi)] bg-[var(--bg)]',
              'focus-within:border-[var(--accent)] focus-within:vt-glow-mint',
              'px-3 py-2 transition-colors',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mono tabular font-semibold leading-none',
                'text-[var(--accent)] text-[15px] pl-1 pr-1',
              )}
            >
              &gt;
            </span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('inputPlaceholder')}
              disabled={isStreaming}
              aria-label={t('inputPlaceholder')}
              className={cn(
                'flex-1 bg-transparent py-2',
                'mono tabular text-[13.5px] text-[var(--fg)]',
                'placeholder:text-[var(--fg-3)]',
                'outline-none disabled:opacity-50',
              )}
            />
            <span
              aria-hidden
              className={cn(
                'self-center mono tabular leading-none',
                'inline-block w-[6px] h-[12px] bg-[var(--accent)]',
                !reduced && 'animate-[vt-cursor-blink_1s_steps(2,end)_infinite]',
              )}
            />
            <button
              type="submit"
              disabled={isStreaming || input.trim().length === 0}
              aria-label={isStreaming ? t('streaming') : t('send')}
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded',
                'bg-[var(--accent)] text-[var(--accent-fg)]',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                'hover:opacity-90 transition-opacity',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
              )}
            >
              <Send size={14} strokeWidth={2.5} />
            </button>
          </form>
        )}
      </div>

      {/* Scoped cursor-blink keyframe — duplicated from predict-shell so
          this panel can ship standalone. Reduced-motion users never see
          the animation; the class is only applied when `!reduced`. */}
      <style>{`
        @keyframes vt-cursor-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function EmptyState({ placeholder }: { placeholder: string }) {
  return (
    <div className="flex h-full min-h-[280px] items-center justify-center px-4">
      <p
        className={cn(
          'mono tabular text-[11px] uppercase tracking-[0.16em]',
          'text-[var(--fg-3)] text-center max-w-[42ch]',
        )}
      >
        {placeholder}
      </p>
    </div>
  );
}

function ExhaustedBlock({ onReset }: { onReset: () => void }) {
  const t = useTranslations('predict');
  return (
    <div
      className={cn(
        'vt-bracket relative mt-4 flex flex-col gap-2',
        'rounded-lg border border-[var(--border-hi)] bg-[var(--surface)]',
        'px-4 py-3',
      )}
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
          className={cn(
            'mono tabular text-[10.5px] uppercase tracking-[0.16em]',
            'border border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]',
            'rounded px-3 py-2 hover:opacity-90 transition-opacity',
          )}
        >
          {t('exhaustedBanner.telegramCta')}
        </a>
        {IS_DEV && (
          <button
            type="button"
            onClick={onReset}
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
  );
}

function parseErrorMessage(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'message' in parsed &&
      typeof (parsed as { message: unknown }).message === 'string'
    ) {
      return (parsed as { message: string }).message;
    }
  } catch {
    // fallthrough
  }
  return error.message.slice(0, 200);
}
