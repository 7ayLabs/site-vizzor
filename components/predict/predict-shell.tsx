'use client';

/**
 * PredictShell — the on-site Vizzor chat surface, structured like the
 * Claude / ChatGPT app: left sidebar with nav + recents, a thin model
 * bar at the top, a full-bleed chat thread, and a bottom composer
 * with tool buttons. Adapted for crypto:
 *
 *   - the model selector reflects the Vizzor engine version
 *   - "Tools" surfaces Vizzor slash commands (/wr /precisions /scan …)
 *   - quick-start chips on the empty state are real prediction prompts
 *   - recents live in localStorage (no accounts) so the user's recent
 *     prompts persist across visits without a server roundtrip
 *
 * Engine integration is identical to the previous PredictRoute: same
 * `useChat()` against `/api/predict` which proxies to the real
 * Vizzor `/v1/chat`. SSE → AI SDK protocol translation happens server-
 * side; we just render whatever streams in.
 *
 * Wallet adapter (Phase 2) wraps the shell only when isTokenLive().
 */

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import useSWR from 'swr';
import {
  Plus,
  Search,
  Send,
  PanelLeftClose,
  PanelLeft,
  Settings2,
  Compass,
  Sparkles,
  MessageSquare,
  Library,
  Trash2,
} from 'lucide-react';
import { ChatBubble } from '@/components/predict/chat-bubble';
import { QuotaSidebar } from '@/components/sections/quota-sidebar';
import { isTokenLive } from '@/lib/feature-flags';
import { loadRecents, pushRecent, clearRecents } from './recents-store';

const WalletAdapter = dynamic(
  () => import('@/components/wallet/wallet-provider'),
  { ssr: false, loading: () => null },
);

interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
  isLive: boolean;
}

const quotaFetcher = (url: string) => fetch(url).then((r) => r.json());
const IS_DEV = process.env.NODE_ENV !== 'production';

export function PredictShell() {
  const t = useTranslations('predict');
  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [burnSig, setBurnSig] = useState<string | null>(null);
  const [recents, setRecents] = useState<ReturnType<typeof loadRecents>>([]);
  const threadRef = useRef<HTMLDivElement | null>(null);

  // Quota — shared SWR key with QuotaSidebar so the data dedupes.
  const { data: quota } = useSWR<QuotaState>('/api/quota', quotaFetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  // Burn-session handoff — chat-panel pattern preserved.
  const burnSigRef = useRef<string | null>(burnSig);
  useEffect(() => {
    burnSigRef.current = burnSig;
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

  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport,
    onFinish: () => {
      if (burnSigRef.current) setBurnSig(null);
      setRefreshKey((k) => k + 1);
    },
  });

  // Load recents once on mount.
  useEffect(() => {
    setRecents(loadRecents());
  }, []);

  // Auto-scroll the thread on each new chunk.
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages]);

  const isStreaming = status === 'streaming' || status === 'submitted';
  const isErrored = status === 'error';
  const composerLocked = !!quota?.exhausted && !burnSig;

  const submitPrompt = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming || composerLocked) return;
    sendMessage({ text: trimmed });
    setRecents(pushRecent(trimmed));
    setInput('');
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submitPrompt(input);
  };

  const onNewChat = () => {
    setMessages([]);
    setInput('');
  };

  const onClearRecents = () => {
    clearRecents();
    setRecents([]);
  };

  const onInlineReset = async () => {
    const res = await fetch('/api/quota/reset', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (res.ok) window.location.reload();
  };

  const inner: ReactNode = (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] min-h-[calc(100dvh-56px)] border-t border-[var(--border)]">
      {/* ─────────────── Sidebar ─────────────── */}
      {sidebarOpen && (
        <aside className="border-r border-[var(--border)] bg-[var(--surface)] flex flex-col">
          {/* Top: new chat + collapse */}
          <div className="flex items-center justify-between px-3 py-3 border-b border-[var(--border)]">
            <button
              type="button"
              onClick={onNewChat}
              className="
                flex-1 flex items-center gap-2
                mono tabular text-[11px] uppercase tracking-[0.14em]
                text-[var(--fg)] hover:bg-[var(--surface-2)]
                border border-[var(--border)] px-3 py-2
                transition-colors
              "
            >
              <Plus size={14} strokeWidth={2} />
              <span>{t('shell.newChat')}</span>
            </button>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              aria-label={t('shell.collapseSidebar')}
              className="ml-2 p-2 text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors"
            >
              <PanelLeftClose size={16} strokeWidth={2} />
            </button>
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-[var(--border)]">
            <label className="flex items-center gap-2 px-2 py-1.5 border border-[var(--border)] bg-[var(--bg)]">
              <Search size={12} strokeWidth={2} className="text-[var(--fg-3)]" />
              <input
                type="search"
                placeholder={t('shell.searchPlaceholder')}
                className="flex-1 bg-transparent text-[12px] text-[var(--fg)] placeholder:text-[var(--fg-3)] outline-none"
              />
            </label>
          </div>

          {/* Static nav */}
          <nav className="px-2 py-2 border-b border-[var(--border)] flex flex-col gap-0.5">
            <SidebarItem
              icon={<MessageSquare size={14} strokeWidth={2} />}
              label={t('shell.nav.chat')}
              active
            />
            <SidebarItem
              icon={<Library size={14} strokeWidth={2} />}
              label={t('shell.nav.library')}
              hint={t('shell.nav.libraryHint')}
              onClick={() => submitPrompt('/precisions')}
            />
            <SidebarItem
              icon={<Compass size={14} strokeWidth={2} />}
              label={t('shell.nav.tools')}
              hint={t('shell.nav.toolsHint')}
              onClick={() => submitPrompt('/help')}
            />
          </nav>

          {/* Recents */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between px-4 py-2">
              <p className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
                {t('shell.recents.label')}
              </p>
              {recents.length > 0 && (
                <button
                  type="button"
                  onClick={onClearRecents}
                  aria-label={t('shell.recents.clear')}
                  title={t('shell.recents.clear')}
                  className="text-[var(--fg-3)] hover:text-[var(--danger)] transition-colors"
                >
                  <Trash2 size={12} strokeWidth={2} />
                </button>
              )}
            </div>
            <ul className="px-2 pb-3 flex-1 min-h-0 overflow-y-auto">
              {recents.length === 0 && (
                <li className="px-2 py-2 mono tabular text-[10px] text-[var(--fg-3)]">
                  {t('shell.recents.empty')}
                </li>
              )}
              {recents.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setInput(r.prompt)}
                    className="
                      w-full text-left px-2 py-1.5
                      text-[12px] text-[var(--fg-2)]
                      hover:bg-[var(--surface-2)] hover:text-[var(--fg)]
                      transition-colors truncate
                    "
                    title={r.prompt}
                  >
                    {r.prompt}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Footer: quota mini-card */}
          <div className="border-t border-[var(--border)] p-3">
            <QuotaSidebar
              refreshKey={refreshKey}
              onBurnConfirmed={(sig) => setBurnSig(sig)}
            />
          </div>
        </aside>
      )}

      {/* ─────────────── Main column ─────────────── */}
      <div className="flex flex-col min-h-[calc(100dvh-56px)] min-w-0">
        {/* Top bar — model selector + sidebar reopen */}
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2.5 bg-[var(--bg)]">
          {!sidebarOpen && (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label={t('shell.openSidebar')}
              className="p-1.5 text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors"
            >
              <PanelLeft size={16} strokeWidth={2} />
            </button>
          )}
          <ModelBadge />
          <div className="ml-auto flex items-center gap-2">
            {quota && (
              <span className="mono tabular text-[10px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
                {t('shell.quotaLine', {
                  used: quota.used,
                  limit: quota.limit,
                })}
              </span>
            )}
          </div>
        </div>

        {/* Thread */}
        <div
          ref={threadRef}
          className="flex-1 overflow-y-auto"
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <Welcome onPick={submitPrompt} />
          ) : (
            <div className="mx-auto max-w-[860px] w-full px-4 sm:px-6 py-6 flex flex-col gap-6">
              {messages.map((m) => (
                <ChatBubble key={m.id} message={m} />
              ))}
              {isErrored && error && (
                <div className="border border-[var(--border)] bg-[var(--surface)] px-3 py-2 mono tabular text-[11px] uppercase tracking-[0.14em] text-[var(--danger)]">
                  {parseErrorMessage(error)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-[var(--border)] bg-[var(--bg)]">
          <div className="mx-auto max-w-[860px] w-full px-4 sm:px-6 py-4">
            {composerLocked ? (
              <ExhaustedBanner onReset={onInlineReset} />
            ) : (
              <form
                onSubmit={onSubmit}
                className="
                  flex items-end gap-2
                  border border-[var(--border)] bg-[var(--surface)]
                  focus-within:border-[var(--fg-2)]
                  transition-colors
                  px-3 py-2
                "
              >
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submitPrompt(input);
                    }
                  }}
                  placeholder={t('shell.composer.placeholder')}
                  disabled={isStreaming}
                  rows={1}
                  aria-label={t('shell.composer.placeholder')}
                  className="
                    flex-1 resize-none bg-transparent
                    text-[14px] text-[var(--fg)]
                    placeholder:text-[var(--fg-3)]
                    outline-none py-1.5 max-h-[160px]
                  "
                />

                <ToolButton
                  label="/help"
                  title={t('shell.composer.toolHelp')}
                  onClick={() => submitPrompt('/help')}
                  icon={<Sparkles size={13} strokeWidth={2} />}
                />
                <ToolButton
                  label="/wr"
                  title={t('shell.composer.toolWr')}
                  onClick={() => submitPrompt('/wr')}
                  icon={<Settings2 size={13} strokeWidth={2} />}
                />

                <button
                  type="submit"
                  disabled={isStreaming || input.trim().length === 0}
                  aria-label={t('send')}
                  className="
                    inline-flex h-9 w-9 items-center justify-center
                    bg-[var(--accent)] text-[var(--accent-fg)]
                    disabled:opacity-40 disabled:cursor-not-allowed
                    hover:opacity-90 transition-opacity
                  "
                >
                  <Send size={14} strokeWidth={2.5} />
                </button>
              </form>
            )}

            <p className="mt-2 mono tabular text-[10px] uppercase tracking-[0.14em] text-[var(--fg-3)] text-center">
              {t('shell.composer.footer')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  return isTokenLive() ? <WalletAdapter>{inner}</WalletAdapter> : inner;
}

/* ────────────── subcomponents ────────────── */

function SidebarItem({
  icon,
  label,
  hint,
  active = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        flex items-center gap-2 px-2 py-1.5 text-left
        text-[12.5px]
        transition-colors
        ${
          active
            ? 'bg-[var(--surface-2)] text-[var(--fg)]'
            : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]'
        }
      `}
      title={hint}
    >
      <span className="text-[var(--fg-3)]">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {hint && (
        <span className="mono tabular text-[9.5px] uppercase tracking-[0.14em] text-[var(--fg-3)]">
          {hint}
        </span>
      )}
    </button>
  );
}

function ModelBadge() {
  const t = useTranslations('predict.shell');
  return (
    <span className="inline-flex items-center gap-1.5 mono tabular text-[11px] uppercase tracking-[0.14em] text-[var(--fg)]">
      <span className="text-[var(--accent)]">▣</span>
      {t('model')}
      <span className="text-[var(--fg-3)]">·</span>
      <span className="text-[var(--fg-3)]">{t('modelVersion')}</span>
    </span>
  );
}

function ToolButton({
  label,
  title,
  onClick,
  icon,
}: {
  label: string;
  title: string;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="
        hidden sm:inline-flex items-center gap-1 h-9 px-2
        mono tabular text-[10.5px] uppercase tracking-[0.14em]
        text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]
        border border-transparent hover:border-[var(--border)]
        transition-colors
      "
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Welcome({ onPick }: { onPick: (prompt: string) => void }) {
  const t = useTranslations('predict.shell.welcome');
  const chips = [
    'BTC 4h',
    'ETH 1h',
    'SOL 1d',
    '/wr',
    '/precisions',
    '/price BTC',
  ];
  return (
    <div className="mx-auto max-w-[860px] w-full px-4 sm:px-6 py-16 flex flex-col items-center gap-8 text-center">
      <div className="flex flex-col gap-3">
        <p className="mono tabular text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
          {t('eyebrow')}
        </p>
        <h2 className="display text-[var(--fg)] text-balance text-[26px] sm:text-[34px] leading-[1.1] tracking-tight font-semibold max-w-[24ch]">
          {t('title')}
        </h2>
        <p className="text-[14px] leading-relaxed text-[var(--fg-2)] max-w-[52ch] mx-auto">
          {t('sub')}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 max-w-[680px]">
        {chips.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onPick(c)}
            className="
              mono tabular text-[11px] uppercase tracking-[0.14em]
              border border-[var(--border)] bg-[var(--surface)]
              px-3 py-2 text-[var(--fg)]
              hover:bg-[var(--surface-2)]
              transition-colors
            "
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

function ExhaustedBanner({ onReset }: { onReset: () => void }) {
  const t = useTranslations('predict');
  return (
    <div className="flex flex-col gap-2 border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
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
    const parsed = JSON.parse(error.message);
    if (typeof parsed === 'object' && parsed && 'message' in parsed) {
      return String(parsed.message);
    }
  } catch {
    // fallthrough
  }
  return error.message.slice(0, 200);
}
