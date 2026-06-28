'use client';

/**
 * PredictShell — wallet-gated, liquid-glass layout with crypto widgets
 * in the right rail (Pass 4).
 *
 * Server data — live tickers, public win-rate, last-24h breakdown,
 * recent receipts — is fetched in `app/[locale]/predict/page.tsx` and
 * passed in via props. The shell stays a client component because it
 * owns the chat stream, SWR for auth/quota, the wallet provider
 * subtree, and the responsive drawer.
 *
 * Layout (desktop ≥ lg):
 *   ┌─ LEFT 280px ──┬─ CENTER ────────────┬─ RIGHT 320px ──┐
 *   │  nav + tools  │   welcome / thread  │  tickers card   │
 *   │  search       │   + composer        │  win-rate card  │
 *   │  identity     │                     │  last 24h card  │
 *   │               │                     │  receipts card  │
 *   └───────────────┴─────────────────────┴─────────────────┘
 *
 * Mobile (<lg):
 *   - left rail collapses into a slide-in drawer
 *   - right rail hides (its data is duplicated in the welcome state's
 *     mini-banner so the quota stays visible)
 *   - composer remains sticky at the bottom
 *
 * Custom iconography from `./predict-icons`. No `lucide-react` imports
 * in this file — every visible icon is a hand-drawn SVG owned by the
 * Predict surface.
 */

import Image from 'next/image';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { useTicker } from '@/lib/api';
import { ChatBubble } from '@/components/predict/chat-bubble';
import { TickerStack } from '@/components/predict/ticker-banner';
import { CoinIcon } from '@/components/ui/coin-icon';
import { Link } from '@/i18n/navigation';
import { WalletAuthButton } from '@/components/auth/wallet-auth-button';
import { useRouter } from '@/i18n/navigation';
import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  useConversations,
  type ConversationSummary,
} from './use-conversations';
import { Check, Wallet, ArrowUpRight } from 'lucide-react';
import { paymentNetwork } from '@/lib/payment/network';
import { buildSolscanAccountUrl } from '@/lib/explorer/solana';
import {
  IconBell,
  IconChat,
  IconClose,
  IconHelp,
  IconMenu,
  IconPaperclip,
  IconPlus,
  IconReceipts,
  IconSend,
  IconSettings,
} from './predict-icons';
import { SlashPalette } from './slash-palette';
import { SettingsSheet } from './settings-sheet';
import { AlertsModal } from './alerts-modal';
import { AlertsWatcher } from './alerts-watcher';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface QuotaState {
  connected: boolean;
  tier: 'elite' | 'pro' | 'trial' | 'free';
  trial: {
    inTrial: boolean;
    daysRemaining: number;
    trialExpiresAt: number;
    dailyUsed: number;
    dailyCap: number;
  } | null;
  freeReason: 'never_started' | 'trial_expired' | 'operator_killed' | null;
  subscribed?: boolean;
  // legacy mirror — drop in v0.3.3
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
}

interface AuthState {
  ok: boolean;
  signedIn: boolean;
  wallet?: string;
}

const jsonFetcher = <T,>(url: string): Promise<T> =>
  fetch(url).then((r) => r.json() as Promise<T>);

const IS_DEV = process.env.NODE_ENV !== 'production';
const MAX_CHARS = 3000;

/* ─────────────────────────── Shell ─────────────────────────── */

/**
 * PredictShell — wallet adapter is owned by the parent `/app/*` layout
 * (`AppShellProvider`), so this component just consumes `useWallet()`
 * via the surrounding provider context. Mounting here would create a
 * nested provider tree and break SIWS continuity across surface
 * switches; see `components/app/app-shell-provider.tsx` for the
 * canonical mount point + the `autoConnect={false}` rationale (Phantom
 * silent-connect bug).
 *
 * `initialConversation` opt-in hydrates the shell with a pre-loaded
 * thread (deep-link path `/app/predict/[conversationId]`). When absent
 * the shell behaves as the canonical /app/predict landing.
 */
export interface InitialConversation {
  id: string;
  title: string;
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>;
}

export interface PredictShellProps {
  initialConversation?: InitialConversation;
}

export function PredictShell({ initialConversation }: PredictShellProps = {}) {
  const t = useTranslations('predict');
  const router = useRouter();
  const locale = useLocale();

  const [input, setInput] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    initialConversation?.id ?? null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  // Tracks which message ids we've already POSTed to
  // /api/conversations/[id]/messages so a re-render of useChat state
  // doesn't double-persist. Pre-populated when loading a past chat so
  // its existing rows aren't re-saved as if they were new turns.
  const persistedRef = useRef<Set<string>>(new Set());

  // Persist sidebar state — keep it across reloads the same way Claude
  // and ChatGPT do.
  useEffect(() => {
    const stored = window.localStorage.getItem('vizzor.predict.sidebar');
    if (stored === 'collapsed') setSidebarCollapsed(true);
  }, []);
  useEffect(() => {
    window.localStorage.setItem(
      'vizzor.predict.sidebar',
      sidebarCollapsed ? 'collapsed' : 'expanded',
    );
  }, [sidebarCollapsed]);
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => !v);
  }, []);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const { data: auth, mutate: mutateAuth } = useSWR<AuthState>(
    '/api/auth/session',
    jsonFetcher,
    { revalidateOnFocus: false, refreshInterval: 12_000 },
  );
  const { data: quota, mutate: mutateQuota } = useSWR<QuotaState>(
    '/api/quota',
    jsonFetcher,
    {
      // Mobile users returning to a backgrounded /predict tab were
      // seeing a stale counter until they reloaded. SWR's defaults
      // assume an active desktop focus event will trigger revalidation;
      // mobile browsers don't fire that reliably. Belt-and-braces:
      // poll every 15s, plus refetch on tab-foreground and network
      // reconnect. /api/quota is unrate-limited and reads SQLite —
      // cheap enough to poll without churn.
      refreshInterval: 15_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
    },
  );

  // Live ticker — the same SWR hook that backs the global ticker bar.
  // We expose a {symbol → price} map to the message stream so each
  // assistant bubble can cross-check any price the engine quotes
  // against the live reference. Defends against engine-side LLM
  // hallucinations (a known incident: BTC quoted at $105k while the
  // resolver was reading $63k) without claiming to fix the root cause.
  const ticker = useTicker(15_000);
  const tickerByCoin = useMemo<ReadonlyMap<string, number>>(() => {
    const m = new Map<string, number>();
    for (const e of ticker.data) {
      if (!e.symbol || !Number.isFinite(e.price)) continue;
      m.set(e.symbol.toUpperCase(), e.price);
    }
    return m;
  }, [ticker.data]);

  // Full ticker entry map — used by TickerBanner to render name +
  // price + 24h delta in a single lookup.
  const tickerEntryBySymbol = useMemo(() => {
    const m = new Map<string, { price: number; changePct: number }>();
    for (const e of ticker.data) {
      if (!e.symbol || !Number.isFinite(e.price)) continue;
      m.set(e.symbol.toUpperCase(), { price: e.price, changePct: e.changePct });
    }
    return m;
  }, [ticker.data]);

  // In-session price history per symbol. We append one sample on
  // every ticker poll (≈30s) and keep the last 30 — enough for a
  // smooth ~15min sparkline without ballooning memory. Stored in a
  // ref-backed state so React re-renders banners as samples accrue,
  // but the writes are O(1) and don't churn anything else.
  const [priceHistory, setPriceHistory] = useState<ReadonlyMap<string, readonly number[]>>(
    () => new Map(),
  );
  useEffect(() => {
    if (!ticker.data || ticker.data.length === 0) return;
    setPriceHistory((prev) => {
      const next = new Map(prev);
      for (const e of ticker.data) {
        if (!e.symbol || !Number.isFinite(e.price) || e.price <= 0) continue;
        const sym = e.symbol.toUpperCase();
        const tail = next.get(sym) ?? [];
        // First sample for this symbol: seed the history with the
        // derived 24h-open price + current price so the banner can
        // render a meaningful 2-point curve immediately instead of
        // waiting 30s for the second poll. The open is engine-
        // authoritative (price / (1 + changePct)) so the seed
        // doesn't lie about the trajectory.
        if (tail.length === 0) {
          const denom = 1 + (e.changePct ?? 0);
          const open = denom > 0 ? e.price / denom : null;
          const seeded =
            open && Number.isFinite(open) && open > 0 && open !== e.price
              ? [open, e.price]
              : [e.price];
          next.set(sym, seeded);
          continue;
        }
        // Skip dedup-equal back-to-back samples on subsequent polls
        // to keep the line honest when the ticker returns the same
        // price twice.
        if (tail[tail.length - 1] === e.price) continue;
        const updated = [...tail, e.price].slice(-30);
        next.set(sym, updated);
      }
      return next;
    });
  }, [ticker.data]);

  const signedIn = auth?.signedIn === true;
  const composerLocked =
    !signedIn || (!!quota?.exhausted && !quota?.subscribed);

  const {
    conversations,
    createConversation,
    loadConversation,
    deleteConversation,
    persistMessage,
    bumpRecency,
  } = useConversations({ enabled: signedIn });

  // Forward the browser's resolved IANA timezone on every chat request
  // so the engine can speak the user's local time (the Telegram bot
  // already does this via `/tz`). The header is read by
  // `app/api/predict/route.ts` and forwarded to vizzor-api/v1/chat.
  // We send the URL-path locale explicitly via `x-vizzor-locale` — the
  // engine clamps it to en/es/fr and locks the reply language to it
  // so the chat surface matches the site chrome the user is actually
  // looking at, not the language they happened to type in this turn.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/predict',
        headers: () => {
          const tz =
            typeof Intl !== 'undefined'
              ? Intl.DateTimeFormat().resolvedOptions().timeZone
              : 'UTC';
          return {
            'x-vizzor-timezone': tz || 'UTC',
            'x-vizzor-locale': locale,
          };
        },
      }),
    [locale],
  );

  const { messages, sendMessage, status, error, setMessages, stop } = useChat({
    transport,
    onFinish: () => {
      void mutateQuota();
    },
  });

  // Deep-link hydration — when the page is /app/predict/[conversationId]
  // the server pre-loads the thread and passes it down. We seed useChat
  // exactly once on mount and prime persistedRef so the loaded rows are
  // not re-POSTed to /api/conversations/[id]/messages as if they were
  // new turns. Ownership is already enforced server-side; this hydration
  // is pure UX, not an authz boundary.
  useEffect(() => {
    if (!initialConversation || initialConversation.messages.length === 0) {
      return;
    }
    const restored = initialConversation.messages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: [{ type: 'text' as const, text: m.content }],
    }));
    persistedRef.current = new Set(restored.map((m) => m.id));
    setMessages(restored);
    // Mount-only — the server provides a fresh page (and thus fresh
    // PredictShell) per [conversationId], so the prop is stable for
    // this component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, []);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages]);

  // ⌘/Ctrl+K — global focus shortcut (Claude / Linear / GitHub
  // convention). Lands the caret in the composer from anywhere on the
  // page and opens the mobile drawer so the input is actually visible
  // on narrow widths.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isStreaming = status === 'streaming' || status === 'submitted';
  const isErrored = status === 'error';

  const submitPrompt = useCallback(
    (text: string): void => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming || composerLocked) return;
      // Mint a conversation row before sending so the very first
      // user message lands inside a persisted thread. The new id is
      // reflected in `activeConversationId` immediately; the
      // persistence effect below picks it up on the next render.
      if (signedIn && !activeConversationId) {
        void (async () => {
          const conv = await createConversation(trimmed);
          if (conv) setActiveConversationId(conv.id);
        })();
      }
      sendMessage({ text: trimmed });
      setInput('');
      setDrawerOpen(false);
    },
    [
      isStreaming,
      composerLocked,
      sendMessage,
      signedIn,
      activeConversationId,
      createConversation,
    ],
  );

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    submitPrompt(input);
  };

  const onNewChat = (): void => {
    setMessages([]);
    setInput('');
    setActiveConversationId(null);
    persistedRef.current = new Set();
    setDrawerOpen(false);
    inputRef.current?.focus();
  };

  /**
   * Replace the current thread with a previously-persisted one.
   * `setMessages` resets useChat's internal state to the loaded
   * history; pre-populating `persistedRef` with the loaded ids stops
   * the persistence effect from re-saving them as if they were new
   * turns.
   */
  const onPickConversation = useCallback(
    async (id: string): Promise<void> => {
      const loaded = await loadConversation(id);
      if (!loaded) return;
      setActiveConversationId(loaded.conversation.id);
      const restored = loaded.messages.map((m) => ({
        id: m.id,
        role: m.role,
        parts: [{ type: 'text' as const, text: m.content }],
      }));
      persistedRef.current = new Set(restored.map((m) => m.id));
      setMessages(restored);
      setDrawerOpen(false);
    },
    [loadConversation, setMessages],
  );

  const onDeleteConversation = useCallback(
    async (id: string): Promise<void> => {
      const ok = await deleteConversation(id);
      if (!ok) return;
      if (id === activeConversationId) {
        setMessages([]);
        setActiveConversationId(null);
        persistedRef.current = new Set();
      }
    },
    [deleteConversation, activeConversationId, setMessages],
  );

  /**
   * Persist new user + assistant messages exactly once each.
   * Runs whenever the messages array changes; the ref guard short-
   * circuits anything we've already saved (or loaded from history).
   * The assistant message only gets a non-empty `text` once streaming
   * is done, so this naturally fires on the right tick.
   */
  useEffect(() => {
    if (!signedIn || !activeConversationId) return;
    let bumped = false;
    for (const m of messages) {
      if (persistedRef.current.has(m.id)) continue;
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      const text = m.parts
        .filter((p) => p.type === 'text')
        .map((p) => ('text' in p ? (p.text ?? '') : ''))
        .join('');
      // Assistant rows arrive in tiny deltas; wait until streaming
      // completes before persisting so we save the final string, not
      // the first 12 characters.
      if (m.role === 'assistant' && (status === 'streaming' || status === 'submitted')) {
        continue;
      }
      if (!text.trim()) continue;
      persistedRef.current.add(m.id);
      void persistMessage(activeConversationId, m.role, text);
      bumped = true;
    }
    if (bumped) bumpRecency();
  }, [
    messages,
    status,
    signedIn,
    activeConversationId,
    persistMessage,
    bumpRecency,
  ]);

  const onOpenReceipts = useCallback(() => {
    // typedRoutes doesn't yet know about hashes — cast through never.
    router.push('/app/account#payments' as never);
    setDrawerOpen(false);
  }, [router]);

  const onOpenAlerts = useCallback(() => {
    // Open the in-shell modal instead of navigating away. The modal
    // mounts the same AlertsList component as /app/alerts so the
    // armed/triggered/resolved UI is identical — just framed by a
    // sheet so users stay in the chat surface.
    setAlertsOpen(true);
    setDrawerOpen(false);
  }, []);

  const onOpenSettings = useCallback(() => {
    setSettingsOpen(true);
    setDrawerOpen(false);
  }, []);

  const onSlashPick = useCallback(
    (command: string): void => {
      // Called from the modal mount removed in v0.4 — kept as a
      // typing-time fallback for any consumer that may still hand the
      // shell a command directly. Pre-fills the composer instead of
      // submitting so the user can complete the argument list.
      const trimmed = command.trim();
      setInput((v) => (v ? `${v} ${trimmed}` : trimmed));
      inputRef.current?.focus();
    },
    [],
  );

  const onInlineReset = async (): Promise<void> => {
    const res = await fetch('/api/quota/reset', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (res.ok) void mutateQuota();
  };

  const lastAssistantId = useMemo<string | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.role !== 'user') return m.id;
    }
    return null;
  }, [messages]);

  // Last user message is editable iff the engine isn't still streaming
  // a reply for it. Editing pre-fills the composer + trims the pair so
  // the next submit reads as a regenerate of that turn.
  const lastEditableUserId = useMemo<string | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.role === 'user') return m.id;
    }
    return null;
  }, [messages]);

  /**
   * Pull the user message back into the composer + drop both it and
   * the assistant reply from the thread. The user can then edit and
   * submit as normal — no special regenerate state machine.
   */
  const onEditUserMessage = useCallback(
    (id: string, text: string): void => {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === id);
        if (idx === -1) return prev;
        return prev.slice(0, idx);
      });
      setInput(text);
      setTimeout(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }, 0);
    },
    [setMessages],
  );

  /**
   * Quote a message — prepend `> {text}\n\n` to the composer + focus.
   * Each line of the quoted text is prefixed individually so multi-
   * line quotes still read as a block-quote in the composer. Works
   * for both user and assistant bubbles.
   */
  const onQuoteMessage = useCallback(
    (text: string): void => {
      if (!text) return;
      const quoted = text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      setInput((prev) => {
        // If there's existing composer content, leave a blank line
        // between the quote and the user's draft.
        const separator = prev.trim().length > 0 ? '\n\n' : '\n\n';
        return `${quoted}${separator}${prev}`;
      });
      setTimeout(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        // Cursor lands AT the end so the user types their follow-up
        // immediately after the quote without arrow-key gymnastics.
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }, 0);
    },
    [],
  );

  /**
   * Share a message — copy a deep-link URL to the clipboard that
   * resolves to the conversation + message anchor. The conversation
   * route is SIWS-gated and ownership-checked server-side, so a
   * leaked URL still 404s for non-owners. Visible feedback via sonner
   * toast; the chat-bubble action button also flashes on resolution.
   */
  const onShareMessage = useCallback(
    async (messageId: string): Promise<void> => {
      if (typeof window === 'undefined') return;
      if (!activeConversationId) {
        toast.error(t('share.unsavedTitle'), {
          description: t('share.unsavedBody'),
        });
        throw new Error('no_conversation');
      }
      const origin = window.location.origin;
      const localePrefix = locale === 'en' ? '' : `/${locale}`;
      const url = `${origin}${localePrefix}/app/predict/${activeConversationId}#m-${messageId}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success(t('share.copied'), { description: url });
      } catch (e) {
        toast.error(t('share.copyFailed'), {
          description: (e as Error).message,
        });
        throw e;
      }
    },
    [activeConversationId, locale, t],
  );

  /**
   * Retry the last failed turn. Trims the errored assistant slot from
   * the thread (if any) and re-fires the latest user prompt. Used by
   * the inline error banner that surfaces engine 5xx responses.
   */
  const onRetryLastTurn = useCallback((): void => {
    let lastUserText: string | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.role === 'user') {
        lastUserText = m.parts
          .filter((p) => p.type === 'text')
          .map((p) => ('text' in p ? (p.text ?? '') : ''))
          .join('')
          .trim();
        break;
      }
    }
    if (!lastUserText) return;
    setMessages((prev) => {
      let cut = prev.length;
      for (let i = prev.length - 1; i >= 0; i--) {
        const m = prev[i];
        if (m && m.role === 'user') break;
        cut = i;
      }
      return prev.slice(0, cut);
    });
    sendMessage({ text: lastUserText });
  }, [messages, setMessages, sendMessage]);

  return (
    <div
      className={cn(
        // Only the TickerCarousel (32/36px) sits above the chat on
        // /predict — the global Header is gated off this route by
        // ChromeGate, so the shell reclaims those 56px. 4px difference
        // between mobile/desktop ticker heights is accepted rather
        // than measured.
        'relative h-[calc(100dvh-32px)] sm:h-[calc(100dvh-36px)] overflow-hidden',
        'bg-[var(--bg)] text-[var(--fg)]',
      )}
    >
      <div
        className={cn(
          'h-full min-h-0 grid grid-cols-1 transition-[grid-template-columns] duration-200 ease-out',
          sidebarCollapsed
            ? 'lg:grid-cols-[64px_minmax(0,1fr)]'
            : 'lg:grid-cols-[280px_minmax(0,1fr)]',
        )}
      >
        {/* ─── Left rail ─── */}
        <LeftRail
          search={search}
          onSearch={setSearch}
          conversations={conversations}
          activeConversationId={activeConversationId}
          onPickConversation={(id) => void onPickConversation(id)}
          onDeleteConversation={(id) => void onDeleteConversation(id)}
          onNewChat={onNewChat}
          onOpenAlerts={onOpenAlerts}
          onOpenReceipts={onOpenReceipts}
          onOpenSettings={onOpenSettings}
          signedIn={signedIn}
          wallet={auth?.wallet}
          quota={quota}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          className="hidden lg:flex"
        />

        {/* ─── Center column ─── */}
        <section className="relative flex flex-col h-full min-h-0 min-w-0 overflow-hidden border-l border-[var(--border)]">
          {/* Mobile-only top bar — drawer trigger. The brand lives
              inside the drawer itself (per Pass 25 spec); per-bubble
              compact toggles replaced the previous global density
              control. */}
          <div
            className={cn(
              'lg:hidden flex items-center shrink-0',
              'px-3 h-12',
            )}
          >
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label={t('shell.openSidebar')}
              className={cn(
                'inline-flex h-10 w-10 -ml-1 items-center justify-center rounded-lg',
                'text-[var(--fg-2)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]',
                'transition-colors',
              )}
            >
              <IconMenu size={20} />
            </button>
          </div>

          <div
            ref={threadRef}
            className="flex-1 min-h-0 overflow-y-auto"
            aria-live="polite"
          >
            {!signedIn ? (
              <WalletGate />
            ) : messages.length === 0 ? (
              <Welcome onPick={submitPrompt} />
            ) : (
              <div className="mx-auto max-w-[860px] w-full px-4 sm:px-6 py-6 flex flex-col gap-6">
                {messages.map((m) => {
                  // For user turns, surface a TickerBanner per ticker
                  // mentioned in the prompt. The banner sits BETWEEN
                  // the user bubble and the assistant bubble (= "ground
                  // truth before the model adds its analysis"). Web3
                  // UX precedent: DexScreener / Phantom / Etherscan
                  // pin live market context to the top of any ticker
                  // query. Banners only render for symbols the live
                  // ticker recognizes (avoids false positives like
                  // "TO" or "AND" matching the bare-ticker regex).
                  const isUserTurn = m.role === 'user';
                  const userText = isUserTurn
                    ? m.parts
                        .filter((p) => p.type === 'text')
                        .map((p) => ('text' in p ? p.text : ''))
                        .join(' ')
                    : '';
                  const detectedSymbols = isUserTurn
                    ? extractTickersFromText(
                        userText,
                        new Set(tickerEntryBySymbol.keys()),
                      )
                    : [];
                  return (
                    <div key={m.id} className="flex flex-col gap-3">
                      <ChatBubble
                        message={m}
                        streaming={isStreaming && m.id === lastAssistantId}
                        onEdit={
                          !isStreaming && m.id === lastEditableUserId
                            ? onEditUserMessage
                            : undefined
                        }
                        onQuote={onQuoteMessage}
                        onShare={onShareMessage}
                        editLabel={t('shell.composer.edit')}
                        sourcesLabel={t('shell.composer.sources')}
                        copyLabel={t('shell.composer.copy')}
                        copiedLabel={t('shell.composer.copied')}
                        quoteLabel={t('shell.composer.quote')}
                        quotedLabel={t('shell.composer.quoted')}
                        shareLabel={t('shell.composer.share')}
                        sharedLabel={t('shell.composer.shared')}
                        compactLabel={t('shell.composer.compact')}
                        compactedLabel={t('shell.composer.compacted')}
                        tickerByCoin={tickerByCoin}
                        priceCheck={{
                          label: t('shell.composer.priceCheckLabel'),
                          body: t('shell.composer.priceCheckBody'),
                        }}
                      />
                      {detectedSymbols.length > 0 && (
                        <TickerStack
                          entries={detectedSymbols.map((sym) => {
                            const entry = tickerEntryBySymbol.get(sym);
                            return {
                              symbol: sym,
                              name: tickerDisplayName(sym),
                              price: entry?.price,
                              changePct: entry?.changePct,
                              history: priceHistory.get(sym),
                            };
                          })}
                        />
                      )}
                    </div>
                  );
                })}
                {isErrored && error && (
                  // Degraded banner — the engine returned an error
                  // mid-turn. Surfaces the parsed message and a retry
                  // CTA that resubmits the last user prompt
                  // (preserves history; no destructive state). The
                  // dashed border + accent dot distinguish it from
                  // the inline tool annotations.
                  <div
                    role="alert"
                    className={cn(
                      'flex items-start gap-3 px-3 py-2.5',
                      'rounded-md border border-dashed border-[var(--danger)]',
                      'bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]',
                    )}
                  >
                    <span
                      aria-hidden
                      className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--danger)] shrink-0"
                    />
                    <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                      <p className="text-[12.5px] text-[var(--fg)] leading-snug">
                        {parseErrorMessage(error)}
                      </p>
                      <button
                        type="button"
                        onClick={onRetryLastTurn}
                        className={cn(
                          'self-start mono tabular text-[10.5px] uppercase tracking-[0.16em]',
                          'px-2 py-1 rounded-md',
                          'border border-[var(--border)] bg-[var(--surface)]',
                          'text-[var(--fg-2)] hover:text-[var(--fg)] hover:border-[var(--border-hi)]',
                          'transition-colors',
                        )}
                      >
                        {t('shell.composer.retry')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Suggestions strip — Vizzor-native quick-pick chips placed
              ABOVE the composer. Reads as "things you can ask right
              now" instead of a Polymarket-style header at the top of
              the page. Hidden while the engine is streaming a response
              and on the locked/exhausted states. */}
          {signedIn && !composerLocked && !isStreaming && (
            <ChatTopics
              onSubmit={submitPrompt}
              onInsert={(seed) => {
                // Token chips pre-fill the composer with the bare
                // ticker + space so the user can complete the prompt
                // ("BTC " → user types "4h con funding"). Focusing the
                // textarea is deferred a tick so React's state commit
                // lands before the caret moves to end-of-input.
                setInput((v) => {
                  // If the textarea is empty, just drop the seed. If
                  // it already has content, append a space + seed so
                  // both flow together without surprise reformatting.
                  if (!v) return seed;
                  return v.endsWith(' ') ? `${v}${seed}` : `${v} ${seed}`;
                });
                setTimeout(() => {
                  const el = inputRef.current;
                  if (!el) return;
                  el.focus();
                  const len = el.value.length;
                  el.setSelectionRange(len, len);
                }, 0);
              }}
            />
          )}

          {/* Composer footer — no top divider. The composer card
              itself reads as the visual end of the thread.
              `pb-[max(env(safe-area-inset-bottom),0.75rem)]` keeps the
              composer above iOS's home-indicator pill. */}
          <div className="shrink-0 flex items-center">
            <div
              className="mx-auto max-w-[860px] w-full px-3 sm:px-6 pt-3"
              style={{
                paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0.75rem)',
              }}
            >
              {!signedIn ? (
                <WalletGateMini onSignedIn={() => void mutateAuth()} />
              ) : composerLocked ? (
                <ExhaustedBanner onReset={onInlineReset} quota={quota} />
              ) : (
                <Composer
                  inputRef={inputRef}
                  value={input}
                  onChange={setInput}
                  onSubmit={onSubmit}
                  onStop={stop}
                  isStreaming={isStreaming}
                  placeholder={t('shell.composer.placeholder')}
                  sendLabel={t('send')}
                  stopLabel={t('shell.composer.stop')}
                  hintLabel={t('shell.composer.kbdHint')}
                />
              )}
            </div>
          </div>
        </section>

      </div>

      {drawerOpen && (
        <MobileDrawer
          onClose={() => setDrawerOpen(false)}
          search={search}
          onSearch={setSearch}
          conversations={conversations}
          activeConversationId={activeConversationId}
          onPickConversation={(id) => void onPickConversation(id)}
          onDeleteConversation={(id) => void onDeleteConversation(id)}
          onNewChat={onNewChat}
          onOpenAlerts={onOpenAlerts}
          onOpenReceipts={onOpenReceipts}
          onOpenSettings={onOpenSettings}
          signedIn={signedIn}
          wallet={auth?.wallet}
          quota={quota}
        />
      )}

      {settingsOpen && (
        <SettingsSheet
          locale={locale}
          signedIn={signedIn}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <AlertsModal open={alertsOpen} onClose={() => setAlertsOpen(false)} />
      <AlertsWatcher enabled={signedIn} />
    </div>
  );
}


/* ─────────────────────────── Wallet gate ─────────────────────────── */

function WalletGate() {
  const t = useTranslations('predict.gate');
  return (
    // `min-h-full` makes the gate stretch to fill the thread container's
    // viewport — without it the wrapper collapses to its content height
    // and `justify-center` has nothing to center against, so the block
    // anchors to the top. Padding goes to `py-10` symmetrically so the
    // hero icon + perks land in the optical middle on tall viewports
    // and don't crowd the composer footer on short ones.
    <div className="mx-auto max-w-[640px] w-full min-h-full px-4 sm:px-6 py-10 flex flex-col items-center justify-center gap-6 sm:gap-8 text-center">
      {/* Icon tile — matches the rounded-2xl bordered tiles used by
          how-it-works cards. Wallet glyph (lucide) is semantically
          aligned with the action being requested. */}
      <span
        aria-hidden
        className={cn(
          'inline-flex h-14 w-14 items-center justify-center',
          'rounded-2xl border border-[var(--border)]',
          'bg-[var(--surface-2)] text-[var(--fg)]',
          'vz-rise',
        )}
      >
        <Wallet size={22} strokeWidth={1.5} aria-hidden />
      </span>

      <div className="flex flex-col gap-3 items-center">
        <h2 className="text-[28px] sm:text-[36px] font-semibold tracking-[-0.022em] leading-[1.05] text-[var(--fg)] text-balance">
          {t('title')}
        </h2>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 w-full max-w-[420px] mx-auto justify-items-start vz-rise" style={{ animationDelay: '120ms' }}>
        <GatePerk label={t('perk1')} />
        <GatePerk label={t('perk2')} />
        <GatePerk label={t('perk3')} />
        <GatePerk label={t('perk4')} />
      </ul>
    </div>
  );
}

function WalletGateMini({ onSignedIn }: { onSignedIn: () => void }) {
  useEffect(() => {
    const id = window.setInterval(onSignedIn, 6_000);
    return () => window.clearInterval(id);
  }, [onSignedIn]);

  // Trimmed surface — the previous layout coupled a wallet icon, a
  // hint paragraph ("Connect your wallet to enable the composer"),
  // and the connect button into one row. Removing the hint + icon
  // promotes the button to a single centered call-to-action so the
  // composer footer reads as one action, not three glance points.
  // The wallet provider context note that originally lived above the
  // button is preserved below for the next reader.
  return (
    <div className="flex items-center justify-center vz-rise">
      {/* Open the same selector modal the navbar uses, but signal
          that an outer wallet provider is already mounted (we're
          inside `<SolanaWalletAdapter>` on /predict). The modal
          then SKIPS its own LazyWalletAdapter mount and runs the
          connect flow inside the existing provider context — Phantom
          actually pops the extension instead of hanging on
          "Open Phantom to approve". */}
      <WalletAuthButton hasProvider={true} useModal={true} />
    </div>
  );
}

function GatePerk({ label }: { label: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden
        className={cn(
          'mt-[2px] inline-flex h-4 w-4 items-center justify-center shrink-0',
          'rounded-full border border-[var(--border-hi)] bg-[var(--surface-2)] text-[var(--fg)]',
        )}
      >
        <Check size={9} strokeWidth={2.4} aria-hidden />
      </span>
      <span className="text-[13px] font-medium tracking-tight text-[var(--fg-2)] leading-snug">
        {label}
      </span>
    </li>
  );
}

/* ─────────────────────────── Left rail ─────────────────────────── */

interface LeftRailProps {
  search: string;
  onSearch: (v: string) => void;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  onPickConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onNewChat: () => void;
  onOpenAlerts: () => void;
  onOpenReceipts: () => void;
  onOpenSettings: () => void;
  signedIn: boolean;
  wallet: string | undefined;
  quota?: QuotaState;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** When true, the rail is rendered inside an outer drawer that
   *  already owns brand + close affordances — suppress the local
   *  brand/toggle row so the chrome doesn't double up. */
  embedded?: boolean;
  className?: string;
}

function LeftRail({
  search,
  onSearch,
  conversations,
  activeConversationId,
  onPickConversation,
  onDeleteConversation,
  onNewChat,
  onOpenAlerts,
  onOpenReceipts,
  onOpenSettings,
  signedIn,
  wallet,
  quota,
  collapsed = false,
  onToggleCollapse,
  embedded = false,
  className,
}: LeftRailProps) {
  const t = useTranslations('predict');
  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, search]);

  return (
    <aside
      className={cn(
        'flex-col min-h-0 h-full',
        collapsed ? 'py-3 px-2 items-center' : 'p-4',
        className,
      )}
      aria-label="Predict sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      {/* Top row.
          - Expanded: Vizzor brand (icon + wordmark) on the left,
            larger collapse toggle on the right. The brand replaces
            the global navbar that ChromeGate hides on /predict.
          - Collapsed: just the toggle, centered, larger so it scans
            as the primary control in the 64px gutter.
          - Embedded (mobile drawer): suppressed entirely — the outer
            drawer's header already carries the brand + close. */}
      {!embedded && <div
        className={cn(
          'flex items-center mb-3',
          collapsed ? 'justify-center w-full' : 'justify-between',
        )}
      >
        {!collapsed && (
          <Link
            href="/app/predict"
            aria-label="Vizzor home"
            className="inline-flex items-center gap-2.5 text-[17px] font-semibold tracking-tight text-[var(--fg)] hover:opacity-80 transition-opacity leading-none"
          >
            <Image
              src="/brand/vizzor_darkicon.png"
              alt=""
              width={364}
              height={535}
              priority
              className="block dark:hidden h-7 w-auto"
            />
            <Image
              src="/brand/vizzor_icon.png"
              alt=""
              width={364}
              height={535}
              priority
              className="hidden dark:block h-7 w-auto"
            />
            <span>vizzor</span>
          </Link>
        )}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? t('shell.openSidebar') : t('shell.collapseSidebar')}
            aria-pressed={!collapsed}
            className={cn(
              'inline-flex items-center justify-center rounded-lg',
              collapsed ? 'h-12 w-12' : 'h-10 w-10',
              'text-[var(--fg-2)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]',
              'transition-colors',
            )}
          >
            <IconSidebar collapsed={collapsed} size={collapsed ? 23 : 19} />
          </button>
        )}
      </div>}

      {/* Scrollable middle — collapses gracefully when the viewport is
          short so the bottom Identity row is never clipped. */}
      <div
        className={cn(
          'flex-1 min-h-0 overflow-y-auto -mx-1 px-1',
          'flex flex-col',
          collapsed ? 'items-center' : '',
        )}
      >
        {/* Primary navigation. Icons step up to 20px in compact mode
            so the collapsed gutter reads at a glance. */}
        <nav
          className={cn(
            'flex flex-col',
            collapsed ? 'gap-1 items-center w-full' : 'gap-0.5',
          )}
          aria-label="Predict navigation"
        >
          {/* Sidebar nav — v0.4 collapsed to three destinations.
              The Tools row is gone: the inline `/` palette in the
              composer is the only commands surface now, opened via the
              keystroke or by typing `/` directly. The History row is
              gone too: it had no onClick and only duplicated the
              "Recent chats" section heading below. What remains is
              three real destinations — start, current, and receipts. */}
          <NavButton
            icon={<IconPlus size={collapsed ? 20 : 17} />}
            label={t('shell.newChat')}
            onClick={onNewChat}
            collapsed={collapsed}
          />
          <NavButton
            icon={<IconChat size={collapsed ? 20 : 17} />}
            label={t('shell.nav.chat')}
            active
            collapsed={collapsed}
          />
          {/* Alerts entry — routes to /app/alerts. The app-sidebar's
              footer also carries this, but the app-sidebar is
              suppressed on /app/predict (3-column shell). Mounting
              the entry here keeps alerts discoverable from inside
              chat without re-introducing the umbrella sidebar. */}
          <NavButton
            icon={<IconBell size={collapsed ? 20 : 17} />}
            label={t('shell.nav.alerts')}
            onClick={onOpenAlerts}
            collapsed={collapsed}
          />
          <NavButton
            icon={<IconReceipts size={collapsed ? 20 : 17} />}
            label={t('shell.nav.receipts')}
            onClick={onOpenReceipts}
            collapsed={collapsed}
          />
        </nav>

        {/* Recent chats — server-persisted threads scoped to the
            signed-in wallet. Hidden in the collapsed gutter; the
            count badge on the Recents NavButton above hints at it. */}
        {!collapsed && (
          <div className="mt-5 flex flex-col gap-1">
            <div className="flex items-center justify-between px-3">
              <span className="text-[10.5px] uppercase tracking-[0.16em] text-[var(--fg-3)] font-semibold">
                {t('shell.recents.label')}
              </span>
            </div>
            {filteredConversations.length === 0 ? (
              // Empty state — friendlier than the bare paragraph it
              // replaced. A small inline icon + uppercase eyebrow
              // anchors the empty slot, body explains what populates
              // it next. Matches Claude's "No conversations yet" feel.
              <div className="mx-3 mt-1 flex flex-col gap-1.5 px-3 py-3 rounded-md border border-dashed border-[var(--border)]">
                <div className="flex items-center gap-1.5">
                  <span aria-hidden className="text-[var(--fg-3)]">
                    <IconDotSmall />
                  </span>
                  <span className="mono tabular text-[9.5px] uppercase tracking-[0.18em] font-semibold text-[var(--fg-3)]">
                    {t('shell.recents.emptyEyebrow')}
                  </span>
                </div>
                <p className="text-[11.5px] text-[var(--fg-3)] leading-snug">
                  {signedIn
                    ? t('shell.recents.empty')
                    : t('shell.recents.signInPrompt')}
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {filteredConversations.slice(0, 12).map((c) => (
                  <li key={c.id} className="group/row relative">
                    <button
                      type="button"
                      onClick={() => onPickConversation(c.id)}
                      className={cn(
                        'group w-full flex items-center gap-2 text-left',
                        'pl-3 pr-9 py-1.5 rounded-md',
                        'text-[12px] truncate',
                        'transition-colors',
                        c.id === activeConversationId
                          ? 'bg-[var(--surface-2)] text-[var(--fg)]'
                          : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]',
                      )}
                      title={c.title}
                    >
                      <span aria-hidden className="text-[var(--fg-3)]">
                        <IconDotSmall />
                      </span>
                      <span className="truncate">{c.title}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteConversation(c.id);
                      }}
                      aria-label={t('shell.recents.delete')}
                      className={cn(
                        'absolute right-1 top-1/2 -translate-y-1/2',
                        'inline-flex h-6 w-6 items-center justify-center rounded',
                        'text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface)]',
                        'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100',
                        'transition-opacity',
                      )}
                    >
                      <IconClose size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Identity — pinned bottom. Mirrors the composer footer in the
          center column: same border-t, same `py-3`, same flex
          alignment. The `-mx` bleed lets the hairline span the full
          sidebar width despite the aside's own p-4 padding. */}
      <div
        className={cn(
          'shrink-0 border-t border-[var(--border)] flex items-center',
          collapsed
            ? '-mx-2 px-2 py-3 justify-center'
            : '-mx-4 px-4 py-3',
        )}
      >
        <Identity
          signedIn={signedIn}
          wallet={wallet}
          collapsed={collapsed}
          onOpenSettings={onOpenSettings}
        />
      </div>
    </aside>
  );
}

function IconSidebar({ collapsed, size = 15 }: { collapsed: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2.5" y="3" width="11" height="10" rx="2" />
      <line x1="6" y1="3" x2="6" y2="13" />
      {collapsed ? (
        <path d="M9 6l2 2-2 2" />
      ) : (
        <path d="M11 6l-2 2 2 2" />
      )}
    </svg>
  );
}

function IconDotSmall() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden>
      <circle cx="4" cy="4" r="1.5" />
    </svg>
  );
}

function NavButton({
  icon,
  label,
  meta,
  active,
  onClick,
  collapsed = false,
}: {
  icon: ReactNode;
  label: string;
  meta?: string;
  active?: boolean;
  onClick?: () => void;
  collapsed?: boolean;
}) {
  // Common label/icon colour state — keep the icon and the text in
  // lock-step so the hover and active treatments read as a single
  // affordance. No borders here: the active highlight is bg-only so
  // hover never shifts layout by 1px when a border appears.
  const tonal = active
    ? 'bg-[var(--surface-2)] text-[var(--fg)]'
    : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]';
  const iconTone = active
    ? 'text-[var(--fg)]'
    : 'text-[var(--fg-3)] group-hover:text-[var(--fg)]';

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        title={label}
        className={cn(
          'group inline-flex items-center justify-center',
          'h-11 w-11 rounded-lg transition-colors',
          tonal,
        )}
      >
        <span className={cn('transition-colors', iconTone)}>{icon}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group w-full flex items-center gap-2.5 text-left',
        'h-9 px-3 rounded-lg',
        'text-[13px] font-medium leading-none',
        'transition-colors',
        tonal,
      )}
    >
      <span aria-hidden className={cn('transition-colors', iconTone)}>
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {meta && (
        <span
          className={cn(
            'mono tabular text-[10px] uppercase tracking-[0.14em] transition-colors',
            active ? 'text-[var(--fg-2)]' : 'text-[var(--fg-3)] group-hover:text-[var(--fg-2)]',
          )}
        >
          {meta}
        </span>
      )}
    </button>
  );
}

type DropdownPhase = 'closed' | 'enter' | 'open' | 'exit';

interface SessionWithSub {
  ok?: boolean;
  signedIn?: boolean;
  wallet?: string;
  subscription?: {
    tier: string;
    cadence: string;
    expiresAt: number | null;
    isLifetime: boolean;
  } | null;
}

function tierBadgeFor(sub: SessionWithSub['subscription'] | undefined): string | null {
  if (!sub) return null;
  const cadenceLabel = sub.isLifetime
    ? 'Lifetime'
    : sub.cadence.charAt(0).toUpperCase() + sub.cadence.slice(1);
  return `${sub.tier.toUpperCase()} · ${cadenceLabel}`;
}

function Identity({
  signedIn,
  wallet,
  collapsed = false,
  onOpenSettings,
}: {
  signedIn: boolean;
  wallet: string | undefined;
  collapsed?: boolean;
  onOpenSettings?: () => void;
}) {
  const t = useTranslations('predict.shell');
  const tAuth = useTranslations('auth');
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<DropdownPhase>('closed');
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Pull the same session SWR the app-sidebar wallet pill uses so the
  // dropdown can surface subscription tier + expiry without a second
  // round-trip. SWR's cache dedup means this is free when the
  // app-shell provider already has the key warm; otherwise it's a
  // single /api/auth/session call shared across the surface.
  const { data: sessionData } = useSWR<SessionWithSub>(
    '/api/auth/session',
    (url: string) =>
      fetch(url, { credentials: 'same-origin' }).then((r) => r.json()),
    { revalidateOnFocus: false, keepPreviousData: true },
  );
  const subscription = sessionData?.subscription ?? null;
  const tierBadge = tierBadgeFor(subscription);
  const network = paymentNetwork();

  // Two-phase animation: a frame after mount we flip from `enter`
  // (initial collapsed state) to `open` (visible state) so the CSS
  // transition runs. On close we flip to `exit` for the duration of
  // the transition, then unmount.
  useEffect(() => {
    if (open) {
      if (phase === 'closed' || phase === 'exit') {
        setPhase('enter');
        const id = requestAnimationFrame(() => setPhase('open'));
        return () => cancelAnimationFrame(id);
      }
    } else {
      if (phase === 'open' || phase === 'enter') {
        setPhase('exit');
        const id = window.setTimeout(() => setPhase('closed'), 140);
        return () => window.clearTimeout(id);
      }
    }
  }, [open, phase]);

  const isMounted = phase !== 'closed';
  const isVisible = phase === 'open';

  const short =
    signedIn && wallet
      ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}`
      : t('identityName');
  const meta = signedIn ? t('identityConnected') : t('identityMeta');

  // Outside-click + Escape — dismiss the dropdown without nuking
  // focus. The listener attaches only while open so the sidebar pays
  // nothing in idle.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent): void => {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const onSignOut = async (): Promise<void> => {
    setOpen(false);
    try {
      await fetch('/api/auth/session', {
        method: 'DELETE',
        credentials: 'same-origin',
      });
    } finally {
      window.location.reload();
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${short} menu`}
        title={collapsed ? `${short} · ${meta}` : undefined}
        className={cn(
          'w-full flex items-center gap-2.5 rounded-lg transition-colors',
          collapsed
            ? 'h-10 w-10 justify-center p-0'
            : 'px-2 py-2 text-left hover:bg-[var(--surface-2)]',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center shrink-0',
            'rounded-full bg-[var(--fg)] text-[var(--bg)]',
            'text-[12px] font-bold',
          )}
        >
          V
        </span>
        {!collapsed && (
          <span className="min-w-0 flex flex-col leading-tight flex-1 text-left">
            <span className="text-[12.5px] font-semibold text-[var(--fg)] truncate mono tabular">
              {short}
            </span>
            <span className="text-[11px] text-[var(--fg-3)] truncate">{meta}</span>
          </span>
        )}
      </button>

      {isMounted && (
        <div
          role="menu"
          className={cn(
            // Width up to 280px so the full wallet address + tier badge
            // fit on one line without breaking the dropdown chrome.
            'absolute z-50 w-[min(280px,calc(100vw-24px))]',
            collapsed
              ? 'left-full ml-2 bottom-0 origin-bottom-left'
              : 'left-0 bottom-full mb-2 origin-bottom-left',
            'rounded-2xl border border-[var(--border)] bg-[var(--surface)]',
            'shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)]',
            'overflow-hidden',
            'transition-[opacity,transform] duration-150 ease-out',
            isVisible
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 translate-y-1 pointer-events-none',
          )}
        >
          {/* ── Identity header ─────────────────────────────────────
              Eyebrow + full wallet address. Matches the navbar pill's
              dropdown so the predict surface and the marketing-host
              wallet pill share the same vocabulary for "signed in as
              this wallet." */}
          {signedIn && wallet && (
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <p className="mono tabular text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--fg-3)]">
                {tAuth('signedInAs')}
              </p>
              <p className="mono tabular text-[11.5px] text-[var(--fg)] break-all mt-1.5">
                {wallet}
              </p>
            </div>
          )}

          {/* ── Subscription ────────────────────────────────────────
              Tier + cadence pill + expiry date when the wallet has an
              active subscription. Reads from the shared
              /api/auth/session SWR so it stays in sync with the
              navbar pill. */}
          {signedIn && subscription && tierBadge && (
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <p className="mono tabular text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--fg-3)]">
                {tAuth('subscription')}
              </p>
              <p className="text-[13px] font-medium tracking-tight text-[var(--fg)] mt-1.5">
                {tierBadge}
              </p>
              {subscription.expiresAt && !subscription.isLifetime && (
                <p className="mono tabular text-[10px] text-[var(--fg-3)] mt-0.5">
                  {tAuth('expiresOn', {
                    date: new Date(subscription.expiresAt).toLocaleDateString(),
                  })}
                </p>
              )}
            </div>
          )}

          {/* ── Network + Explorer ──────────────────────────────────
              Read-only display of the active chain plus a deep-link to
              Solscan for the connected wallet. */}
          {signedIn && wallet && (
            <div className="px-4 py-3 border-b border-[var(--border)] flex flex-col gap-2">
              <p className="mono tabular text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--fg-3)]">
                {tAuth('network')}
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className="mono tabular text-[10.5px] uppercase tracking-[0.16em] px-2 py-0.5 rounded-md bg-[var(--fg)] text-[var(--bg)]">
                  Solana {network}
                </span>
                <a
                  href={buildSolscanAccountUrl(wallet, network)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="
                    inline-flex items-center gap-1 text-[11.5px] font-medium tracking-tight
                    text-[var(--fg-2)] hover:text-[var(--fg)]
                    transition-colors
                  "
                >
                  <span>{tAuth('viewOnExplorer')}</span>
                  <ArrowUpRight size={11} strokeWidth={2} />
                </a>
              </div>
            </div>
          )}

          {/* ── Actions ─────────────────────────────────────────────
              Settings + Profile + Help routed actions, plus Sign out
              as a destructive terminal. Each row is a real menu item
              with the inset-icon vocabulary the chat-bubble dropdowns
              use elsewhere on the surface. */}
          <div className="p-1">
            <DropdownItem
              icon={<IconSettings size={15} />}
              label={t('settings')}
              onClick={() => {
                setOpen(false);
                onOpenSettings?.();
              }}
            />
            {signedIn && (
              <DropdownLink
                href="/app/account"
                icon={<IconUser size={15} />}
                label={tAuth('viewProfile')}
                onClick={() => setOpen(false)}
              />
            )}
            <DropdownLink
              href="/docs"
              icon={<IconHelp size={15} />}
              label={t('help')}
              onClick={() => setOpen(false)}
            />
            {signedIn && (
              <DropdownItem
                icon={<IconSignOut size={15} />}
                label={tAuth('signOut')}
                onClick={() => void onSignOut()}
                tone="danger"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const dropdownItemClass = cn(
  'group w-full flex items-center gap-2.5 text-left',
  'h-8 px-2.5 rounded-md',
  'text-[13px] text-[var(--fg-2)]',
  'hover:bg-[var(--surface-2)] hover:text-[var(--fg)]',
  'transition-colors',
);

function DropdownItem({
  icon,
  label,
  onClick,
  tone = 'default',
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  /** `danger` shifts the row to the destructive token set on hover so
   *  sign-out reads as a terminal action without crying for attention
   *  in the idle state. */
  tone?: 'default' | 'danger';
}) {
  const toneClass =
    tone === 'danger'
      ? cn(
          'text-[var(--fg-2)] hover:text-[var(--danger)]',
          'hover:bg-[color-mix(in_oklab,var(--danger)_10%,transparent)]',
        )
      : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]';
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'group w-full flex items-center gap-2.5 text-left',
        'h-8 px-2.5 rounded-md text-[13px]',
        'transition-colors',
        toneClass,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'transition-colors',
          tone === 'danger'
            ? 'text-[var(--fg-3)] group-hover:text-[var(--danger)]'
            : 'text-[var(--fg-3)] group-hover:text-[var(--fg)]',
        )}
      >
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

function DropdownLink({
  href,
  icon,
  label,
  onClick,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href as never}
      role="menuitem"
      onClick={onClick}
      className={dropdownItemClass}
    >
      <span aria-hidden className="text-[var(--fg-3)] group-hover:text-[var(--fg)] transition-colors">
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
    </Link>
  );
}

function IconUser({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.5c1-2.5 3-3.5 5-3.5s4 1 5 3.5" />
    </svg>
  );
}

function IconSignOut({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9.5 12.5h-5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h5" />
      <path d="M10 5.5 12.5 8 10 10.5" />
      <path d="M6.5 8h6" />
    </svg>
  );
}

/* ─────────────────────────── Mobile drawer ─────────────────────────── */

function MobileDrawer({
  onClose,
  search,
  onSearch,
  conversations,
  activeConversationId,
  onPickConversation,
  onDeleteConversation,
  onNewChat,
  onOpenAlerts,
  onOpenReceipts,
  onOpenSettings,
  signedIn,
  wallet,
  quota,
}: {
  onClose: () => void;
  search: string;
  onSearch: (v: string) => void;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  onPickConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onNewChat: () => void;
  onOpenAlerts: () => void;
  onOpenReceipts: () => void;
  onOpenSettings: () => void;
  signedIn: boolean;
  wallet: string | undefined;
  quota?: QuotaState;
}) {
  const t = useTranslations('predict');

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="lg:hidden fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-label={t('shell.openSidebar')}
    >
      <button
        type="button"
        aria-label={t('shell.collapseSidebar')}
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
      />
      <div
        className={cn(
          'relative flex flex-col w-[min(320px,86vw)] h-full',
          'bg-[var(--surface)] backdrop-blur-2xl',
          'motion-safe:animate-[vt-drawer-in_200ms_ease-out]',
        )}
      >
        <style>{`
          @keyframes vt-drawer-in {
            from { transform: translate3d(-100%, 0, 0); }
            to   { transform: translate3d(0, 0, 0); }
          }
        `}</style>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <Link
            href="/app/predict"
            aria-label="Vizzor home"
            className="inline-flex items-center gap-2.5 text-[16px] font-semibold tracking-tight text-[var(--fg)] leading-none hover:opacity-80 transition-opacity"
          >
            <Image
              src="/brand/vizzor_darkicon.png"
              alt=""
              width={364}
              height={535}
              priority
              className="block dark:hidden h-6 w-auto"
            />
            <Image
              src="/brand/vizzor_icon.png"
              alt=""
              width={364}
              height={535}
              priority
              className="hidden dark:block h-6 w-auto"
            />
            <span>vizzor</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('shell.collapseSidebar')}
            className="inline-flex h-9 w-9 items-center justify-center text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] rounded-lg transition-colors"
          >
            <IconClose size={18} />
          </button>
        </div>
        {/* The drawer wrapper itself stays paddingless so LeftRail can
            own the horizontal rhythm. Letting LeftRail keep its default
            `p-4` gives nav items breathing room from the drawer edge
            (16px) instead of jamming them against it (the alignment
            issue flagged on mobile). */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <LeftRail
            search={search}
            onSearch={onSearch}
            conversations={conversations}
            activeConversationId={activeConversationId}
            onPickConversation={onPickConversation}
            onDeleteConversation={onDeleteConversation}
            onNewChat={onNewChat}
            onOpenAlerts={onOpenAlerts}
            onOpenReceipts={onOpenReceipts}
            onOpenSettings={onOpenSettings}
            signedIn={signedIn}
            wallet={wallet}
            quota={quota}
            embedded
            className="flex h-full border-0 bg-transparent shadow-none backdrop-blur-none"
          />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Composer ─────────────────────────── */

function Composer({
  inputRef,
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  placeholder,
  sendLabel,
  stopLabel,
  hintLabel,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  /** Aborts the in-flight engine stream — wired to `useChat().stop()`. */
  onStop: () => void;
  isStreaming: boolean;
  placeholder: string;
  sendLabel: string;
  stopLabel: string;
  hintLabel: string;
}) {
  // The palette opens whenever the input starts with `/` and a space
  // hasn't been typed yet (i.e. the user is still naming the command).
  // It also opens when the user clicks the explicit "Browse prompts"
  // button — the manual-open flag is OR'd with the auto-trigger.
  const [manualOpen, setManualOpen] = useState(false);
  const autoOpen =
    value.startsWith('/') && !value.includes(' ') && !isStreaming;
  const showPalette = (autoOpen || manualOpen) && !isStreaming;

  useEffect(() => {
    if (isStreaming) {
      setManualOpen(false);
    }
  }, [isStreaming]);

  // Auto-grow the textarea fluidly with the content — the height
  // tracks `scrollHeight` capped at 140px, so the input glides open as
  // the user types and snaps back when the value clears (after send).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, 140);
    el.style.height = `${next}px`;
  }, [value, inputRef]);

  const onPaletteClose = (): void => {
    setManualOpen(false);
  };

  const onPaletteInsert = (command: string): void => {
    // Replace just the leading slash-fragment if present; otherwise
    // append the command. Keep the cursor at the end so the user can
    // continue typing the argument inline.
    if (value.startsWith('/')) {
      const space = value.indexOf(' ');
      const tail = space === -1 ? '' : value.slice(space);
      onChange(`${command} ${tail.trimStart()}`.trimEnd() + ' ');
    } else {
      const sep = value.length && !value.endsWith(' ') ? ' ' : '';
      onChange(`${value}${sep}${command} `);
    }
    setManualOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const hasValue = value.trim().length > 0;
  const canSend = hasValue && !isStreaming;

  return (
    <form
      onSubmit={onSubmit}
      className={cn(
        // Liquid-glass chrome — mirrors the /docs navbar search bar
        // exactly: fully transparent surface, heavier backdrop blur,
        // hairline border. Focus tightens the border to var(--fg) but
        // does NOT solidify the background, so the surface keeps its
        // glass quality while reading as "active". `backdrop-saturate`
        // gives the slight chromatic lift you see on iOS / macOS
        // glass surfaces — what stops it from feeling like a frosted
        // dialog and starts feeling like a refractive material.
        'relative flex items-end gap-1.5',
        'rounded-3xl px-3 py-2',
        'border border-[var(--border)]',
        'bg-[color-mix(in_oklab,var(--surface)_18%,transparent)]',
        'backdrop-blur-[10px] backdrop-saturate-[140%]',
        'focus-within:border-[var(--fg)]',
        'focus-within:bg-[color-mix(in_oklab,var(--surface)_28%,transparent)]',
        'transition-[border-color,background-color] duration-200 ease-out',
        'vz-rise',
      )}
    >
      {showPalette && (
        <SlashPalette
          query={value}
          onPick={onPaletteInsert}
          onClose={onPaletteClose}
        />
      )}

      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_CHARS))}
        onKeyDown={(e) => {
          // ⌘/Ctrl + ↵ always submits, regardless of whether the
          // palette is open — power-user shortcut that matches Claude
          // / ChatGPT. Plain ↵ submits only when the palette is
          // closed; with the palette open ↵ inserts the focused row
          // (handled inside SlashPalette).
          const cmdEnter = e.key === 'Enter' && (e.metaKey || e.ctrlKey);
          if (cmdEnter) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            if (showPalette) return;
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder={placeholder}
        disabled={isStreaming}
        rows={1}
        aria-label={placeholder}
        aria-expanded={showPalette}
        aria-controls={showPalette ? 'predict-slash-palette' : undefined}
        className={cn(
          'flex-1 resize-none bg-transparent outline-none',
          'text-[14px] text-[var(--fg)] leading-relaxed',
          'placeholder:text-[var(--fg-3)] placeholder:transition-opacity placeholder:duration-200',
          'focus:placeholder:opacity-60',
          // px-1.5 keeps the caret off the focus ring; py-1.5 vertically
          // centres single-line state with the send button.
          'px-1.5 py-1.5 min-w-0',
          'max-h-[140px] overflow-y-auto',
          'transition-[height] duration-150 ease-out',
        )}
      />

      {isStreaming ? (
        // Stop button — replaces send while the engine is streaming so
        // the user can abort a long response (Claude / ChatGPT
        // convention). Uses the destructured `useChat().stop` upstream.
        <button
          type="button"
          onClick={onStop}
          aria-label={stopLabel}
          className={cn(
            'shrink-0 inline-flex h-9 w-9 sm:h-8 sm:w-8 items-center justify-center rounded-full',
            'self-end mb-px',
            'bg-[var(--surface-2)] text-[var(--fg)]',
            'border border-[var(--border-hi)]',
            'transition-[background-color,color,transform] duration-150 ease-out',
            'hover:bg-[color-mix(in_oklab,var(--fg)_8%,transparent)]',
            'active:scale-95',
          )}
        >
          {/* Solid square — universal "stop" glyph */}
          <span
            aria-hidden
            className="block w-2.5 h-2.5 rounded-[2px] bg-[var(--fg)]"
          />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!canSend}
          aria-label={sendLabel}
          className={cn(
            // 36px target on touch, 32px on sm+. Ghost when input is
            // empty (so the chrome stays calm), fills + lifts when the
            // user has something to send. The scale-down on empty makes
            // the appearance of "ready to send" feel like the button
            // grows toward the cursor.
            'shrink-0 inline-flex h-9 w-9 sm:h-8 sm:w-8 items-center justify-center rounded-full',
            'self-end mb-px',
            'transition-[background-color,color,transform,opacity] duration-200 ease-out',
            canSend
              ? 'bg-[var(--fg)] text-[var(--bg)] scale-100 opacity-100'
              : 'bg-transparent text-[var(--fg-3)] scale-90 opacity-70',
            'disabled:cursor-not-allowed',
            'hover:enabled:scale-105 active:enabled:scale-95',
          )}
        >
          <IconSend size={13} />
        </button>
      )}

      {/* Kbd hint — sits as a footer row inside the composer card,
          mirroring Claude's "↵ to send · ⇧↵ for new line" affordance.
          Hidden while streaming so the row reads as "active work" not
          "type here". */}
      {!isStreaming && (
        <span
          aria-hidden
          className={cn(
            'absolute left-3 right-12 bottom-[-1.25rem]',
            'mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]',
            'pointer-events-none select-none',
            'opacity-0 focus-within:opacity-100 transition-opacity duration-200',
          )}
        >
          {hintLabel}
        </span>
      )}
    </form>
  );
}

/* ─────────────────────────── Chat topics bar ─────────────────────────── */

type TopicIconKind =
  | 'spark'
  | 'wave'
  | 'check'
  | 'target'
  | 'receipt'
  | 'gauge'
  | 'liquid'
  | 'stack'
  | 'dice'
  | 'chip'
  | 'mesh'
  | 'building'
  | 'cycle'
  | 'radar'
  | 'globe'
  | 'shield'
  | 'bars'
  | 'anchor'
  | 'flag';

interface TopicSpec {
  id: string;
  label: string;
  /** What lands in the composer / submits. Tokens use the bare ticker
   *  + space so the user can complete the horizon ("BTC " → user types
   *  "4h con funding"). Non-token chips carry a full submit-now prompt. */
  prompt: string;
  /** When set, the chip renders `<CoinIcon symbol={ticker}>` as the
   *  prefix. Used for majors so the chip reads as a directional CTA on
   *  that coin. */
  ticker?: string;
  /** Otherwise, an inline mono SVG drawn by `<TopicIcon kind={icon}>`. */
  icon?: TopicIconKind;
  /** `'insert'` — prefill the composer + focus, let user complete the
   *  prompt. Used for token chips so they read as "compose a prediction
   *  for this asset" rather than "ask the canned thing".
   *  `'submit'` — fire the prompt immediately. The default for general
   *  catalysts like "Whale flow" where the canned prompt IS the value. */
  behavior?: 'insert' | 'submit';
}

/**
 * Canonical topic catalog — every chip the user can possibly have on
 * their bar. Ordered as the default-bar layout (Vizzor-native concepts
 * first, then majors, then catalysts).
 *
 * The Vizzor-native head (high-conviction, whale flow, resolved) used
 * to be a separate constant with a `<li>` separator between it and the
 * body. v0.4 collapses both into a single catalog because the bar is
 * now user-reorderable — splitting them stops being meaningful when
 * the user can intermix freely.
 */
const TOPICS_CATALOG: ReadonlyArray<TopicSpec> = [
  // Vizzor-native head (engine's first-class concepts)
  { id: 'high-conviction', label: 'High conviction', icon: 'spark', prompt: 'Show me current high-conviction predictions', behavior: 'submit' },
  { id: 'whale', label: 'Whale flow', icon: 'wave', prompt: 'Recent whale-confirmed signals', behavior: 'submit' },
  { id: 'resolved', label: 'Just resolved', icon: 'check', prompt: 'Show me just-resolved receipts', behavior: 'submit' },
  // Majors — pre-fill so the user completes the horizon. The bare
  // ticker + trailing space is what lands in the composer; the user
  // types "4h", "1d con funding", etc.
  { id: 'btc', label: 'Bitcoin', ticker: 'BTC', prompt: 'BTC ', behavior: 'insert' },
  { id: 'eth', label: 'Ethereum', ticker: 'ETH', prompt: 'ETH ', behavior: 'insert' },
  { id: 'sol', label: 'Solana', ticker: 'SOL', prompt: 'SOL ', behavior: 'insert' },
  { id: 'ton', label: 'Toncoin', ticker: 'TON', prompt: 'TON ', behavior: 'insert' },
  // Vizzor-internal surfaces — submit-now
  { id: 'wr', label: 'Tracked WR', icon: 'target', prompt: '/wr', behavior: 'submit' },
  { id: 'precisions', label: 'Receipts', icon: 'receipt', prompt: '/precisions', behavior: 'submit' },
  { id: 'calibration', label: 'Calibration', icon: 'gauge', prompt: 'Show me per-horizon calibration trust', behavior: 'submit' },
  // Crypto-native sectors
  { id: 'defi', label: 'DeFi', icon: 'liquid', prompt: 'DeFi sector update', behavior: 'submit' },
  { id: 'l2', label: 'L2s', icon: 'stack', prompt: 'Layer 2 ecosystem update', behavior: 'submit' },
  { id: 'memes', label: 'Memes', icon: 'dice', prompt: 'Top memecoins trending now', behavior: 'submit' },
  { id: 'ai', label: 'AI agents', icon: 'chip', prompt: 'AI agents in crypto', behavior: 'submit' },
  { id: 'depin', label: 'DePIN', icon: 'mesh', prompt: 'DePIN trends and tokens', behavior: 'submit' },
  { id: 'rwa', label: 'RWA', icon: 'building', prompt: 'Real-world asset tokens', behavior: 'submit' },
  { id: 'restaking', label: 'Restaking', icon: 'cycle', prompt: 'Restaking trends and yields', behavior: 'submit' },
  { id: 'pre-news', label: 'Pre-news', icon: 'radar', prompt: 'Pre-news signals firing now', behavior: 'submit' },
  // Catalysts that move crypto
  { id: 'macro', label: 'Macro', icon: 'globe', prompt: 'Macro outlook — Fed, DXY, rates, and crypto impact', behavior: 'submit' },
  { id: 'etfs', label: 'ETF flows', icon: 'bars', prompt: 'Latest BTC and ETH spot ETF net flows', behavior: 'submit' },
  { id: 'regulation', label: 'Regulation', icon: 'shield', prompt: 'Crypto regulation watch — SEC, MiCA, Korea', behavior: 'submit' },
  { id: 'stables', label: 'Stables', icon: 'anchor', prompt: 'Stablecoin supply changes and depeg risk', behavior: 'submit' },
  { id: 'geopolitics', label: 'Geopolitics', icon: 'flag', prompt: 'Geopolitics and crypto — sanctions, capital flight', behavior: 'submit' },
  { id: 'stocks', label: 'Stocks tape', icon: 'bars', prompt: 'Crypto-correlated stocks — MSTR, COIN, NVDA', behavior: 'submit' },
];

const TOPICS_BY_ID: Record<string, TopicSpec> = Object.fromEntries(
  TOPICS_CATALOG.map((t) => [t.id, t]),
);

/**
 * Default chip order — the user's first-time bar. After v0.4 the user
 * can drag-reorder, add, and remove; their choices persist in
 * localStorage under `STORAGE_KEY` below.
 */
const DEFAULT_BAR_IDS: ReadonlyArray<string> = [
  'high-conviction',
  'whale',
  'resolved',
  'btc',
  'eth',
  'sol',
  'ton',
  'wr',
  'precisions',
];

const STORAGE_KEY = 'vizzor.predict.topic-bar.v1';

interface StoredBar {
  v: 1;
  ids: ReadonlyArray<string>;
}

/**
 * Hydrate the chip order from localStorage with strict validation —
 * unknown ids (catalog evolution between releases) are dropped, the
 * default list back-fills if the stored payload is empty / corrupt.
 * Pure read; never throws.
 */
function loadBarIds(): string[] {
  if (typeof window === 'undefined') return [...DEFAULT_BAR_IDS];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_BAR_IDS];
    const parsed = JSON.parse(raw) as StoredBar | null;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.ids)) {
      return [...DEFAULT_BAR_IDS];
    }
    const valid = parsed.ids.filter(
      (id): id is string => typeof id === 'string' && id in TOPICS_BY_ID,
    );
    return valid.length > 0 ? valid : [...DEFAULT_BAR_IDS];
  } catch {
    return [...DEFAULT_BAR_IDS];
  }
}

function saveBarIds(ids: ReadonlyArray<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, ids } satisfies StoredBar),
    );
  } catch {
    // Best-effort — private mode / quota / etc. The order will just
    // reset on next mount; not worth a UI error for.
  }
}

/* ─────────────────────── custom tokens ─────────────────────── */

/**
 * User-defined tokens. Stored separately from the catalog so the
 * built-in topic list can evolve between releases without colliding
 * with whatever ticker the user typed in. Persisted under a versioned
 * key for the same forward-compat reason as the bar order.
 *
 * The id namespace is `custom-<SYMBOL>` so it never overlaps with the
 * built-in ids; the merge helper below dedupes by id when surfacing
 * them in the catalog.
 */
const CUSTOM_TOKENS_KEY = 'vizzor.predict.custom-tokens.v1';
const CUSTOM_TOKEN_SYMBOL_RE = /^[A-Z0-9]{2,10}$/;

interface StoredCustomTokens {
  v: 1;
  symbols: ReadonlyArray<string>;
}

function loadCustomTokens(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_TOKENS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredCustomTokens | null;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.symbols)) return [];
    const valid: string[] = [];
    const seen = new Set<string>();
    for (const s of parsed.symbols) {
      if (typeof s !== 'string') continue;
      const up = s.toUpperCase();
      if (!CUSTOM_TOKEN_SYMBOL_RE.test(up)) continue;
      if (seen.has(up)) continue;
      seen.add(up);
      valid.push(up);
    }
    return valid;
  } catch {
    return [];
  }
}

function saveCustomTokens(symbols: ReadonlyArray<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CUSTOM_TOKENS_KEY,
      JSON.stringify({ v: 1, symbols } satisfies StoredCustomTokens),
    );
  } catch {
    // Best-effort.
  }
}

/* ─────────────────────── ticker extraction ─────────────────────── */

/**
 * Friendly name → uppercase symbol. Used by `extractTickersFromText`
 * so a prompt like "What about Bitcoin today?" still surfaces the BTC
 * banner. Symbols not in this map only match via the `$BTC` or bare
 * uppercase pattern.
 */
const TICKER_NAME_MAP: Record<string, string> = {
  bitcoin: 'BTC',
  btc: 'BTC',
  ethereum: 'ETH',
  eth: 'ETH',
  solana: 'SOL',
  sol: 'SOL',
  toncoin: 'TON',
  ton: 'TON',
  hyperliquid: 'HYPE',
  hype: 'HYPE',
  pyth: 'PYTH',
  jup: 'JUP',
  jupiter: 'JUP',
};

const DOLLAR_TICKER_RE = /\$([A-Z0-9]{2,10})\b/gi;
const BARE_TICKER_RE = /\b([A-Z]{2,10})\b/g;

/**
 * Pull a deduped list of ticker symbols out of a user message.
 *
 *   1. `$BTC` / `$eth` — explicit ticker mentions (case-insensitive
 *      thanks to the `i` flag on DOLLAR_TICKER_RE).
 *   2. Bare uppercase `BTC` — only when the symbol is in
 *      `knownSymbols` so "TO" or "AND" don't trigger banners.
 *   3. Friendly names (`bitcoin`, `Solana`) → mapped via
 *      TICKER_NAME_MAP.
 *
 * Order preserved (first mention wins) so banners stack in the order
 * the user thought about them.
 */
function extractTickersFromText(
  text: string,
  knownSymbols: ReadonlySet<string>,
): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (sym: string): void => {
    const up = sym.toUpperCase();
    if (seen.has(up)) return;
    if (!knownSymbols.has(up)) return;
    seen.add(up);
    out.push(up);
  };
  // $TICKER pattern — case-insensitive.
  for (const m of text.matchAll(DOLLAR_TICKER_RE)) {
    if (m[1]) push(m[1]);
  }
  // Bare uppercase ticker — exact case to avoid false positives.
  for (const m of text.matchAll(BARE_TICKER_RE)) {
    if (m[1]) push(m[1]);
  }
  // Friendly names — case-insensitive whole-word scan.
  const lower = text.toLowerCase();
  for (const [name, sym] of Object.entries(TICKER_NAME_MAP)) {
    const re = new RegExp(`\\b${name}\\b`, 'i');
    if (re.test(lower)) push(sym);
  }
  return out;
}

/** Friendly display name for a banner — falls back to the symbol. */
function tickerDisplayName(symbol: string): string {
  const up = symbol.toUpperCase();
  const inverted: Record<string, string> = {
    BTC: 'Bitcoin',
    ETH: 'Ethereum',
    SOL: 'Solana',
    TON: 'Toncoin',
    HYPE: 'Hyperliquid',
    PYTH: 'Pyth Network',
    JUP: 'Jupiter',
  };
  return inverted[up] ?? up;
}

/** Produce a TopicSpec for a user-defined token symbol. */
function customTokenToSpec(symbol: string): TopicSpec {
  const up = symbol.toUpperCase();
  return {
    id: `custom-${up}`,
    label: up,
    ticker: up,
    prompt: `${up} `,
    behavior: 'insert',
  };
}

function ChatTopics({
  onSubmit,
  onInsert,
}: {
  /** Fire-and-forget submit — used for `behavior: 'submit'` chips. */
  onSubmit: (prompt: string) => void;
  /** Pre-fill composer + focus — used for `behavior: 'insert'` chips
   *  (the token chips). The argument is the bare seed text the chip
   *  declares; the parent composer drops it into the textarea and
   *  positions the cursor at the end. */
  onInsert: (seed: string) => void;
}) {
  // Hydrated lazily on mount so SSR doesn't see localStorage and the
  // first paint matches the default layout. The reorder/add/remove
  // handlers then mutate this state and persist on every change.
  const [barIds, setBarIds] = useState<string[]>(() => [...DEFAULT_BAR_IDS]);
  const [customTokens, setCustomTokens] = useState<string[]>(() => []);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setBarIds(loadBarIds());
    setCustomTokens(loadCustomTokens());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) saveBarIds(barIds);
  }, [barIds, hydrated]);
  useEffect(() => {
    if (hydrated) saveCustomTokens(customTokens);
  }, [customTokens, hydrated]);

  // Live ticker — used to render price + delta on ticker chips. One
  // subscription at this scope is cheaper than per-chip useSWR; the
  // map below makes lookups O(1) in the render path.
  const { data: tickerData } = useTicker();
  const priceBySymbol = useMemo(() => {
    const map = new Map<string, { price: number; changePct: number }>();
    (tickerData ?? []).forEach((t) => {
      map.set(t.symbol.toUpperCase(), {
        price: t.price,
        changePct: t.changePct,
      });
    });
    return map;
  }, [tickerData]);

  // Merge built-in catalog with user-defined tokens. Custom tokens
  // get appended (catalog-first ordering) so the built-in head stays
  // recognizable; the panel renders them in their own section.
  const customSpecs = useMemo(
    () => customTokens.map(customTokenToSpec),
    [customTokens],
  );
  const allTopicsById = useMemo(() => {
    const merged: Record<string, TopicSpec> = { ...TOPICS_BY_ID };
    for (const spec of customSpecs) merged[spec.id] = spec;
    return merged;
  }, [customSpecs]);

  const [addOpen, setAddOpen] = useState(false);
  // Closing-phase flag for the (+) add panel — keeps the panel mounted
  // while the slide-out keyframe plays. Same pattern as the
  // SlashPalette modal's `slashClosing` previously. The 160ms below
  // matches the `slash-palette-slide-out` duration in globals.css.
  const [addClosing, setAddClosing] = useState(false);
  const dismissAdd = useCallback(() => {
    setAddClosing(true);
    window.setTimeout(() => {
      setAddOpen(false);
      setAddClosing(false);
    }, 160);
  }, []);
  const toggleAdd = useCallback(() => {
    if (addOpen) dismissAdd();
    else setAddOpen(true);
  }, [addOpen, dismissAdd]);

  // dnd-kit sensors: 6px pointer activation so a regular click still
  // fires `onSubmit` without accidentally starting a drag. Keyboard
  // sensor lets Space + arrows reorder the bar for accessibility.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const onDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setBarIds((ids) => {
      const oldIdx = ids.indexOf(String(active.id));
      const newIdx = ids.indexOf(String(over.id));
      if (oldIdx === -1 || newIdx === -1) return ids;
      return arrayMove(ids, oldIdx, newIdx);
    });
  }, []);

  const removeChip = useCallback((id: string) => {
    setBarIds((ids) => ids.filter((x) => x !== id));
  }, []);

  const addChip = useCallback((id: string) => {
    setBarIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setAddOpen(false);
  }, []);

  /** Add a user-defined token by symbol. The symbol is upper-cased
   *  and validated (2-10 alphanumeric chars) before being persisted.
   *  Returns the spec id when successful so the caller can also drop
   *  the new chip directly into the bar. */
  const addCustomToken = useCallback(
    (rawSymbol: string): string | null => {
      const up = rawSymbol.trim().toUpperCase().replace(/^\$/, '');
      if (!CUSTOM_TOKEN_SYMBOL_RE.test(up)) return null;
      const spec = customTokenToSpec(up);
      // If a built-in already exists for this symbol, just add it to
      // the bar (don't duplicate as a custom).
      const builtin = TOPICS_CATALOG.find(
        (t) => t.ticker?.toUpperCase() === up,
      );
      if (builtin) {
        setBarIds((ids) => (ids.includes(builtin.id) ? ids : [...ids, builtin.id]));
        return builtin.id;
      }
      setCustomTokens((list) => (list.includes(up) ? list : [...list, up]));
      setBarIds((ids) => (ids.includes(spec.id) ? ids : [...ids, spec.id]));
      return spec.id;
    },
    [],
  );

  const available = useMemo(() => {
    const merged = [...TOPICS_CATALOG, ...customSpecs];
    return merged.filter((t) => !barIds.includes(t.id));
  }, [barIds, customSpecs]);

  const onChipPick = useCallback(
    (topic: TopicSpec) => {
      if (topic.behavior === 'insert') {
        onInsert(topic.prompt);
      } else {
        onSubmit(topic.prompt);
      }
    },
    [onInsert, onSubmit],
  );

  return (
    <nav
      aria-label="Prompt suggestions"
      className={cn(
        'relative shrink-0',
        'mx-auto max-w-[860px] w-full px-3 sm:px-6 pt-2',
      )}
    >
      {/* The (+) trigger sits OUTSIDE the scrollable `<ul>` so its popover
          isn't clipped by the carousel's `overflow-x-auto`. The flex row
          gives the ul the remaining width (min-w-0 lets it actually shrink
          below content width and scroll) and pins the (+) to the right. */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1 min-w-0">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={barIds} strategy={horizontalListSortingStrategy}>
              <ul
                className={cn(
                  // Single-line carousel: `flex-nowrap` forbids wrapping
                  // and `whitespace-nowrap` belts-and-braces against any
                  // inline descendant that might force a break.
                  'flex flex-nowrap items-center gap-1.5 overflow-x-auto whitespace-nowrap',
                  '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                )}
              >
                {barIds.map((id, idx) => {
                  const topic = allTopicsById[id];
                  if (!topic) return null;
                  const ticker = topic.ticker?.toUpperCase();
                  const live = ticker ? priceBySymbol.get(ticker) : undefined;
                  return (
                    <SortableTopicChip
                      key={id}
                      topic={topic}
                      onPick={onChipPick}
                      onRemove={removeChip}
                      highlighted={idx === 0}
                      livePrice={live?.price}
                      liveChangePct={live?.changePct}
                    />
                  );
                })}
              </ul>
            </SortableContext>
          </DndContext>

          {/* Edge fades — anchored to the scroll container, not the (+)
              region, so they cue overflow on the chips alone. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-6"
            style={{
              background:
                'linear-gradient(to right, var(--bg), color-mix(in oklab, var(--bg) 0%, transparent))',
            }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-6"
            style={{
              background:
                'linear-gradient(to left, var(--bg), color-mix(in oklab, var(--bg) 0%, transparent))',
            }}
          />
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={toggleAdd}
            aria-label={addOpen ? 'Close suggestions menu' : 'Add suggestion'}
            aria-expanded={addOpen}
            aria-haspopup="menu"
            className={cn(
              'inline-flex items-center justify-center',
              'h-7 w-7 rounded-full',
              'border border-dashed',
              'motion-safe:will-change-transform',
              'transition-[background-color,border-color,color,transform] duration-150 ease-out',
              'hover:scale-[1.04] active:scale-95',
              addOpen
                ? cn(
                    // Active fill — solid surface flip so the (+) reads
                    // as "the open trigger" while the panel is mounted.
                    'border-[var(--fg)] bg-[var(--fg)] text-[var(--bg)]',
                  )
                : cn(
                    'border-[var(--border)] text-[var(--fg-3)]',
                    'hover:text-[var(--fg)] hover:border-[var(--border-hi)] hover:bg-[var(--surface-2)]',
                  ),
            )}
          >
            {/* Icon morph: a single + glyph that rotates 45° when the
                panel is open so it reads as ×. The rotation is on the
                SVG itself (not the button) so the active-state bg
                transition doesn't pull the icon out of center. */}
            <svg
              width={11}
              height={11}
              viewBox="0 0 16 16"
              fill="none"
              className={cn(
                'transition-transform duration-200 ease-out',
                addOpen ? 'rotate-45' : 'rotate-0',
              )}
            >
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
            </svg>
          </button>
          {addOpen && (
            <TopicAddPanel
              available={available}
              onAdd={addChip}
              onAddCustom={addCustomToken}
              onClose={dismissAdd}
              closing={addClosing}
            />
          )}
        </div>
      </div>
    </nav>
  );
}

/**
 * Each chip is its own dnd-kit sortable. The drag handle is the whole
 * chip body — pointer activation constraint (6px) lets a quick click
 * register as `onPick` while a hold-and-drag triggers reorder. The
 * hover-revealed × is the dedicated remove target so it never conflicts
 * with either gesture.
 */
function SortableTopicChip({
  topic,
  onPick,
  onRemove,
  highlighted = false,
  livePrice,
  liveChangePct,
}: {
  topic: TopicSpec;
  onPick: (topic: TopicSpec) => void;
  onRemove: (id: string) => void;
  highlighted?: boolean;
  /** Live spot price for the chip's ticker, when available. Ignored
   *  for non-ticker chips. */
  livePrice?: number;
  /** Fractional 24h change (e.g. -0.021 = -2.1%). */
  liveChangePct?: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: topic.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Ticker chips with a live price render in a "compact instrument"
  // layout — icon + symbol + price + signed delta — instead of the
  // long label. Minimalist, single-line, no busy chart. Falls back to
  // the label layout when no price is wired yet (initial load).
  const showLivePrice =
    Boolean(topic.ticker) && typeof livePrice === 'number' && livePrice > 0;
  const deltaPct = typeof liveChangePct === 'number' ? liveChangePct * 100 : null;
  const isUp = (deltaPct ?? 0) >= 0;

  return (
    <li ref={setNodeRef} style={style} className={cn('shrink-0 relative group/chip', isDragging && 'z-10')}>
      <button
        type="button"
        onClick={() => onPick(topic)}
        {...attributes}
        {...listeners}
        className={cn(
          'inline-flex items-center gap-1.5',
          'h-7 px-2.5 rounded-full',
          'text-[12.5px] font-semibold tracking-tight leading-none whitespace-nowrap',
          'transition-[background-color,color,border-color,box-shadow,transform] duration-200 ease-out',
          'motion-safe:will-change-transform',
          'hover:scale-[1.03] active:scale-95',
          highlighted
            ? 'bg-[var(--fg)] text-[var(--bg)]'
            : 'border border-[var(--border)] text-[var(--fg-2)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] hover:border-[var(--border-hi)]',
          isDragging && 'opacity-80 cursor-grabbing shadow-[0_6px_18px_-8px_color-mix(in_oklab,var(--fg)_45%,transparent)]',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'inline-flex items-center justify-center shrink-0',
            highlighted ? 'text-[var(--bg)]' : 'text-[var(--fg-3)]',
          )}
        >
          {topic.ticker ? (
            <CoinIcon symbol={topic.ticker} size={14} />
          ) : topic.icon ? (
            <TopicIcon kind={topic.icon} size={12} />
          ) : (
            <TopicIcon kind="spark" size={12} />
          )}
        </span>
        {showLivePrice && typeof livePrice === 'number' ? (
          <>
            <span className="mono tabular">{topic.ticker}</span>
            <span
              className={cn(
                'mono tabular font-medium',
                highlighted ? 'text-[var(--bg)]/85' : 'text-[var(--fg-3)]',
              )}
            >
              {formatChipPrice(livePrice)}
            </span>
            {deltaPct !== null && Number.isFinite(deltaPct) && (
              <span
                className={cn(
                  'mono tabular text-[10.5px] font-semibold',
                  highlighted
                    ? 'text-[var(--bg)]/85'
                    : isUp
                      ? 'text-[var(--up)]'
                      : 'text-[var(--down)]',
                )}
                aria-label={`24h change ${deltaPct.toFixed(2)} percent`}
              >
                <span aria-hidden>{isUp ? '▲' : '▼'}</span>
                {Math.abs(deltaPct).toFixed(1)}%
              </span>
            )}
          </>
        ) : (
          <span>{topic.label}</span>
        )}
      </button>
      <button
        type="button"
        aria-label={`Remove ${topic.label}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(topic.id);
        }}
        className={cn(
          'absolute -top-1.5 -right-1.5',
          'h-4 w-4 rounded-full',
          'inline-flex items-center justify-center',
          'bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-3)]',
          'opacity-0 group-hover/chip:opacity-100',
          'hover:bg-[var(--surface-2)] hover:text-[var(--fg)]',
          'transition-opacity duration-150',
        )}
      >
        <svg width={7} height={7} viewBox="0 0 8 8" fill="none">
          <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
        </svg>
      </button>
    </li>
  );
}

/** Compact price formatter for the chip strip — keeps the chip narrow
 *  so the carousel fits more entries without horizontal scrolling. */
function formatChipPrice(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(6)}`;
}

/**
 * Tiny dropdown panel anchored to the (+) button. Lists every chip in
 * the catalog that the user hasn't added yet. Click to add. ESC + click
 * outside dismiss. Uses the same slide-in keyframes as the slash
 * palette for visual consistency.
 */
function TopicAddPanel({
  available,
  onAdd,
  onAddCustom,
  onClose,
  closing = false,
}: {
  available: ReadonlyArray<TopicSpec>;
  onAdd: (id: string) => void;
  /** Add a user-defined token by symbol. Returns the spec id on
   *  success, null when the symbol failed validation. */
  onAddCustom: (rawSymbol: string) => string | null;
  onClose: () => void;
  /** When true, render the slide-out keyframe instead of slide-in. The
   *  parent keeps the panel mounted for ~160ms so the exit animation
   *  reads as decisive instead of snapping to unmount. */
  closing?: boolean;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [customInput, setCustomInput] = useState('');
  const [customError, setCustomError] = useState(false);

  const submitCustom = useCallback(() => {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    const id = onAddCustom(trimmed);
    if (id) {
      setCustomInput('');
      setCustomError(false);
      onClose();
    } else {
      setCustomError(true);
    }
  }, [customInput, onAddCustom, onClose]);

  // Re-clamp the active index if `available` shrinks (the user added a
  // topic and the panel re-rendered with one fewer row).
  useEffect(() => {
    if (activeIdx >= available.length) {
      setActiveIdx(available.length === 0 ? 0 : available.length - 1);
    }
  }, [activeIdx, available.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      // Don't hijack keystrokes when the user is typing in the custom
      // token input — Enter there submits the input, not a menu pick.
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') {
        return;
      }
      if (available.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(available.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        const picked = available[activeIdx];
        if (picked) {
          e.preventDefault();
          onAdd(picked.id);
        }
      }
    };
    const onClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-topic-add-panel]')) return;
      // The (+) toggle handles its own dismiss via toggleAdd, so swallow
      // outside-clicks that land on it to avoid a double-dismiss race.
      if (target?.closest('[aria-haspopup="menu"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onClick);
    };
  }, [activeIdx, available, onAdd, onClose]);

  // Scroll the focused row into view as the user arrow-navigates.
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLLIElement>(`[data-idx="${activeIdx}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  return (
    <div
      data-topic-add-panel
      role="menu"
      aria-label="Add topic to bar"
      className={cn(
        'absolute z-30',
        // Anchor: above the (+) trigger, right-aligned to its edge so the
        // panel grows leftward into the bar — the (+) sits at the
        // rightmost end of the carousel, and a left-anchored panel would
        // run off the viewport on narrow widths. Opening above also keeps
        // the panel out of the composer textarea below.
        'right-0 bottom-full mb-2',
        'min-w-[240px] max-h-[280px] overflow-y-auto',
        // Solid minimalist surface — matches SlashPalette. Transparent
        // popovers bleed the chips bar through and confuse the reading
        // hierarchy, so both popovers on this screen stay fully opaque.
        'rounded-2xl border border-[var(--border)]',
        'bg-[var(--surface)]',
        'shadow-[0_12px_36px_-18px_color-mix(in_oklab,#000_85%,transparent)]',
        'motion-safe:will-change-transform',
        closing
          ? 'motion-safe:slash-palette-slide-out'
          : 'motion-safe:slash-palette-slide-in',
        'overflow-hidden pb-1',
      )}
    >
      {/* Section stamp — mono eyebrow vocabulary matches the home-page
          cards (how-it-works, hero stat tiles) so the popover reads as
          part of the same design system, not a separate dropdown chrome. */}
      <p className="px-3 pt-3 pb-1.5 mono tabular text-[10px] uppercase tracking-[0.2em] font-semibold text-[var(--fg-3)]">
        Add topic
      </p>
      {/* Custom token entry — type any symbol the engine knows (BTC,
          HYPE, etc.). The chip is added immediately and persists in
          localStorage so the user's bar feels theirs. Validation
          lives in the parent (CUSTOM_TOKEN_SYMBOL_RE); we only flash
          a hairline error when the parent rejects. */}
      <div className="px-2 pb-2 border-b border-[var(--border)]/60">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitCustom();
          }}
          className={cn(
            'flex items-center gap-1.5 h-8 px-2 rounded-md border',
            'bg-[var(--surface-2)] transition-colors',
            customError
              ? 'border-[var(--danger)]'
              : 'border-[var(--border)] focus-within:border-[var(--border-hi)]',
          )}
        >
          <span aria-hidden className="mono tabular text-[11px] text-[var(--fg-3)] shrink-0">$</span>
          <input
            type="text"
            value={customInput}
            onChange={(e) => {
              setCustomInput(e.target.value);
              if (customError) setCustomError(false);
            }}
            placeholder="Add token — e.g. HYPE"
            aria-label="Add custom token"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="characters"
            className={cn(
              'flex-1 min-w-0 bg-transparent outline-none',
              'mono tabular text-[12px] uppercase tracking-tight text-[var(--fg)]',
              'placeholder:text-[var(--fg-3)] placeholder:normal-case placeholder:tracking-normal placeholder:font-normal',
            )}
            maxLength={11}
          />
          <button
            type="submit"
            disabled={!customInput.trim()}
            aria-label="Add token"
            className={cn(
              'shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-full',
              'text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface)]',
              'transition-colors',
              'disabled:opacity-40 disabled:pointer-events-none',
            )}
          >
            <svg width={10} height={10} viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
            </svg>
          </button>
        </form>
      </div>
      {available.length === 0 ? (
        <p className="px-3 py-2 text-[12.5px] leading-snug text-[var(--fg-3)]">
          Every topic is already in the bar.
        </p>
      ) : (
        <ul ref={listRef} className="flex flex-col max-h-[220px] overflow-y-auto">
          {available.map((t, idx) => {
            const active = idx === activeIdx;
            return (
              <li key={t.id} data-idx={idx}>
                <button
                  type="button"
                  role="menuitem"
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => onAdd(t.id)}
                  className={cn(
                    'relative w-full flex items-center gap-2.5 px-3 py-2 text-left',
                    // Home-page list-item vocabulary: sans, slightly
                    // larger, medium weight, tight tracking. Matches the
                    // CTA chip rhythm in `how-it-works.client.tsx`.
                    'text-[13px] font-medium tracking-tight leading-snug transition-colors',
                    // Left-edge accent — same focus-cue pattern as the
                    // slash palette. No heavy background flood.
                    'before:absolute before:left-0 before:top-1.5 before:bottom-1.5',
                    'before:w-[2px] before:rounded-r-full',
                    'before:transition-colors',
                    active
                      ? 'bg-[color-mix(in_oklab,var(--fg)_4%,transparent)] text-[var(--fg)] before:bg-[var(--fg)]'
                      : 'text-[var(--fg-2)] before:bg-transparent hover:text-[var(--fg)] hover:bg-[color-mix(in_oklab,var(--fg)_3%,transparent)]',
                  )}
                >
                  <span aria-hidden className="inline-flex items-center justify-center shrink-0 w-4 text-[var(--fg-3)]">
                    {t.ticker ? (
                      <CoinIcon symbol={t.ticker} size={14} />
                    ) : t.icon ? (
                      <TopicIcon kind={t.icon} size={12} />
                    ) : (
                      <TopicIcon kind="spark" size={12} />
                    )}
                  </span>
                  <span className="flex-1">{t.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Inline 16x16 mono SVGs for topic chips. All paths are
 * `stroke="currentColor"` so the chip tint controls the colour, and
 * each glyph is hand-drawn rather than picked from Lucide.
 */
function TopicIcon({ kind, size = 12 }: { kind: TopicIconKind; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (kind) {
    case 'spark':
      // High-conviction — trending-up arrow + breakout glyph
      return (
        <svg {...common}>
          <path d="M2 11.5L6 7.5l2.5 2.5L14 4" />
          <path d="M10 4h4v4" />
        </svg>
      );
    case 'wave':
      // Whale flow — soft double-wave
      return (
        <svg {...common}>
          <path d="M2 6c1.5-1.5 3-1.5 4 0s2.5 1.5 4 0 2.5-1.5 4 0" />
          <path d="M2 11c1.5-1.5 3-1.5 4 0s2.5 1.5 4 0 2.5-1.5 4 0" />
        </svg>
      );
    case 'check':
      // Just-resolved — checkmark in circle
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="M5 8.5l2 2 4-4.5" />
        </svg>
      );
    case 'target':
      // Tracked WR — bullseye
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <circle cx="8" cy="8" r="3" />
          <circle cx="8" cy="8" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'receipt':
      // Receipts — paper with zig-zag bottom
      return (
        <svg {...common}>
          <path d="M4 2.5h8v11l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1L4 13.5z" />
          <path d="M6 6h4M6 8.5h4" />
        </svg>
      );
    case 'gauge':
      // Calibration — half-arc gauge with needle
      return (
        <svg {...common}>
          <path d="M2.5 11a5.5 5.5 0 0 1 11 0" />
          <path d="M8 11L11 7" />
          <circle cx="8" cy="11" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'liquid':
      // DeFi — droplet
      return (
        <svg {...common}>
          <path d="M8 2.5c-2.5 3-4 5-4 7a4 4 0 0 0 8 0c0-2-1.5-4-4-7z" />
        </svg>
      );
    case 'stack':
      // L2s — 3 stacked layers
      return (
        <svg {...common}>
          <path d="M8 2.5L14 5L8 7.5L2 5z" />
          <path d="M2 8L8 10.5L14 8" />
          <path d="M2 11L8 13.5L14 11" />
        </svg>
      );
    case 'dice':
      // Memes — a die rotated for character
      return (
        <svg {...common}>
          <rect x="3" y="3" width="10" height="10" rx="2" />
          <circle cx="6" cy="6" r="0.8" fill="currentColor" stroke="none" />
          <circle cx="10" cy="10" r="0.8" fill="currentColor" stroke="none" />
          <circle cx="10" cy="6" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'chip':
      // AI agents — IC with pins
      return (
        <svg {...common}>
          <rect x="4" y="4" width="8" height="8" rx="1" />
          <path d="M6.5 4V2.5M9.5 4V2.5M6.5 13.5V12M9.5 13.5V12M4 6.5H2.5M4 9.5H2.5M13.5 6.5H12M13.5 9.5H12" />
        </svg>
      );
    case 'mesh':
      // DePIN — interconnected nodes
      return (
        <svg {...common}>
          <circle cx="3.5" cy="4" r="1.2" />
          <circle cx="12.5" cy="4" r="1.2" />
          <circle cx="8" cy="12" r="1.2" />
          <path d="M4.5 4.7L11.5 4.7M4.3 5L7.3 11.2M11.7 5L8.7 11.2" />
        </svg>
      );
    case 'building':
      // RWA — 4-story building
      return (
        <svg {...common}>
          <path d="M3.5 13.5V4.5L8 2L12.5 4.5V13.5" />
          <path d="M6 8H6.01M10 8H10.01M6 10.5H6.01M10 10.5H10.01" strokeWidth="2.4" />
          <path d="M2.5 13.5h11" />
        </svg>
      );
    case 'cycle':
      // Restaking — circular arrows
      return (
        <svg {...common}>
          <path d="M3.5 6.5A5 5 0 0 1 12.5 5.5" />
          <path d="M12.5 9.5A5 5 0 0 1 3.5 10.5" />
          <path d="M10.5 3.5L12.5 5.5L10.5 7" />
          <path d="M5.5 12.5L3.5 10.5L5.5 9" />
        </svg>
      );
    case 'radar':
      // Pre-news — radar sweep
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 8L13 4.5" />
          <path d="M8 8L5 3" />
        </svg>
      );
    case 'globe':
      // Macro — globe with latitude/longitude
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="M2 8h12M8 2c2 2.5 2 9.5 0 12M8 2c-2 2.5-2 9.5 0 12" />
        </svg>
      );
    case 'shield':
      // Regulation — shield outline
      return (
        <svg {...common}>
          <path d="M8 2.5L13 4v4c0 3-2 5-5 6-3-1-5-3-5-6V4z" />
        </svg>
      );
    case 'bars':
      // ETFs / Stocks — bar chart with ascending bars
      return (
        <svg {...common}>
          <path d="M3 13V10M6.5 13V7M10 13V9M13.5 13V4" />
        </svg>
      );
    case 'anchor':
      // Stables — anchor
      return (
        <svg {...common}>
          <circle cx="8" cy="4" r="1.4" />
          <path d="M8 5.5V13" />
          <path d="M5 8.5h6" />
          <path d="M3 10c0 2 2.2 3.5 5 3.5S13 12 13 10" />
        </svg>
      );
    case 'flag':
      // Geopolitics — flag on a pole
      return (
        <svg {...common}>
          <path d="M4 2.5V13.5" />
          <path d="M4 3h7l-1.5 2.5L11 8H4z" />
        </svg>
      );
    default:
      return null;
  }
}

/* ────────────────────────── Example roll ────────────────────────── */

/**
 * Single-line conversational prompt rotator. One example sits centred
 * under the subtitle and rolls upward every 4s via the
 * `vz-example-roll` keyframe (defined in globals.css). The wrapping
 * button submits the foregrounded prompt on click; hover pauses the
 * cycle so a slow-moving cursor doesn't trigger a stale example.
 *
 * Why a single chip instead of a marquee or a grid:
 *   - Marquee reads as "ticker" — informational. We want "suggestion".
 *   - Wrapped grid creates visual noise at the empty state, and the
 *     full catalog is already a tap away via the topic bar below.
 *   - A single foregrounded prompt mirrors how the user would phrase
 *     their first question — a single sentence, one click to send.
 */
function ExampleRoll({
  examples,
  eyebrow,
  onPick,
}: {
  examples: ReadonlyArray<string>;
  eyebrow: string;
  onPick: (text: string) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (examples.length <= 1 || paused) return;
    const id = window.setInterval(() => {
      setIdx((i) => (i + 1) % examples.length);
    }, 4000);
    return () => window.clearInterval(id);
  }, [examples.length, paused]);
  const current = examples[idx] ?? '';

  return (
    <div
      className="mt-3 flex flex-col items-center gap-2 w-full"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="mono tabular text-[10px] uppercase tracking-[0.2em] text-[var(--fg-3)]">
        {eyebrow}
      </span>
      <button
        type="button"
        onClick={() => onPick(current)}
        aria-live="polite"
        aria-label={current}
        className={cn(
          'group relative inline-flex items-center justify-center',
          'min-h-[2.25rem] max-w-[44ch] px-3 py-1.5',
          'text-[13.5px] leading-snug text-[var(--fg-2)]',
          'rounded-full',
          'transition-colors duration-200 ease-out',
          'hover:text-[var(--fg)]',
          'hover:bg-[color-mix(in_oklab,var(--fg)_4%,transparent)]',
        )}
      >
        {/* The keyed inner span remounts on every idx change, which
            re-fires the vz-example-roll animation for a smooth
            text-up transition. The button shell itself never
            re-mounts, so the click target stays stable across ticks. */}
        <span
          key={current}
          className="vz-example-roll inline-block text-balance"
        >
          {current}
        </span>
        {/* Hairline underline that draws in on hover — the only
            visual chrome on the prompt, so it reads as a hyperlink
            cue rather than a chip. */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute left-3 right-3 bottom-1 h-px',
            'origin-left scale-x-0 group-hover:scale-x-100',
            'bg-[color-mix(in_oklab,var(--fg)_50%,transparent)]',
            'transition-transform duration-300 ease-out',
          )}
        />
      </button>
    </div>
  );
}

/* ─────────────────────────── Welcome ─────────────────────────── */

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  const t = useTranslations('predict.shell.welcome');
  // Rotating example — a single chip below the subtitle that cycles
  // through a localized array every 3.5s with a fade. Reads as a
  // gentle "what should I try" prompt without dragging a full
  // suggestion grid into the hero. The values come from i18n so the
  // ES/EN/FR variants can drift independently.
  const examplesRaw = t('examples');
  const examples = useMemo<string[]>(() => {
    if (!examplesRaw) return [];
    // The key is a `|`-delimited string in messages/*.json so
    // next-intl returns it verbatim; cheaper than a nested array
    // (which would need a different message format).
    return examplesRaw
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }, [examplesRaw]);

  return (
    // Full-height container so the title is vertically centred in the
    // available chat area, not just padded from the top. min-h-full
    // works because the parent thread scroller is the height anchor.
    <div className="min-h-full w-full flex flex-col items-center justify-center px-4 sm:px-6 py-10 text-center">
      <div className="flex flex-col items-center gap-4 vz-rise" style={{ animationDelay: '0ms' }}>
        <span aria-hidden className="inline-flex">
          <Image
            src="/brand/vizzor_darkicon.png"
            alt=""
            width={364}
            height={535}
            priority
            className="block dark:hidden h-9 w-auto opacity-90"
          />
          <Image
            src="/brand/vizzor_icon.png"
            alt=""
            width={364}
            height={535}
            priority
            className="hidden dark:block h-9 w-auto opacity-90"
          />
        </span>
        <h2 className="display text-[var(--fg)] text-balance text-[28px] sm:text-[38px] lg:text-[44px] leading-[1.05] tracking-tight font-semibold max-w-[20ch] mx-auto">
          {t('title')}
        </h2>
        <p className="text-[14.5px] leading-relaxed text-[var(--fg-2)] max-w-[52ch] mx-auto">
          {t('sub')}
        </p>
        {examples.length > 0 && (
          // Roll suggestion — a single prompt sits centred and rolls
          // upward on each tick via the `vz-example-roll` keyframe.
          // Cubic-bezier easing + a brief 2px blur on the rise gives
          // the swap a polished, "spoken word" feel instead of the
          // mechanical scroll of a marquee. The whole row is a button
          // so a single click submits the foregrounded prompt and
          // starts the conversation. Hover pauses the rotation so the
          // click target doesn't morph out from under the cursor.
          <ExampleRoll
            examples={examples}
            eyebrow={t('exampleEyebrow')}
            onPick={onPick}
          />
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Exhausted banner ─────────────────────────── */

/**
 * Pick the i18n key suffix that matches the wallet's current state.
 * Three discrete cases drive separate copy: cap reached today (still
 * in trial), trial fully expired, and operator-killed trial. Falls
 * back to the legacy "exhausted" wording for any unrecognized state
 * so older translations don't blow up.
 */
function pickBannerKey(
  quota: QuotaState | undefined,
  part: 'label' | 'body',
): string {
  const fallback = `exhaustedBanner.${part}`;
  if (!quota) return fallback;
  if (quota.tier === 'trial' && quota.trial && quota.trial.dailyUsed >= quota.trial.dailyCap) {
    return `exhaustedBanner.dailyCap.${part}`;
  }
  if (quota.tier === 'free') {
    if (quota.freeReason === 'trial_expired') return `exhaustedBanner.trialExpired.${part}`;
    if (quota.freeReason === 'operator_killed') return `exhaustedBanner.operatorKilled.${part}`;
    if (quota.freeReason === 'never_started') return `exhaustedBanner.notStarted.${part}`;
  }
  return fallback;
}

function ExhaustedBanner({
  onReset,
  quota,
}: {
  onReset: () => void;
  quota?: QuotaState;
}) {
  const t = useTranslations('predict');
  // The banner doubles as both "trial expired" (plan gate) AND "daily
  // cap reached" (cost shield). The discriminator is the active
  // tier — a trial wallet hitting the daily cap stays in the trial
  // window, so the copy nudges "comes back at 00:00 UTC". An expired
  // trial wallet drops to `free` with a clear subscribe CTA.
  const labelKey = pickBannerKey(quota, 'label');
  const bodyKey = pickBannerKey(quota, 'body');
  return (
    <div className="flex flex-col gap-2 px-4 py-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] vz-rise">
      <p className="text-[11.5px] uppercase tracking-[0.14em] font-semibold text-[var(--fg)]">
        {t(labelKey as 'exhaustedBanner.label')}
      </p>
      <p className="text-[13px] leading-relaxed text-[var(--fg-2)]">
        {t(bodyKey as 'exhaustedBanner.body')}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        {/* Upgrade CTA — `/pricing` is a marketing route that the
            middleware bypasses on the product host, so this link stays
            on `app.vizzor.ai/pricing` (no marketing-site bounce) and
            falls through to the regular checkout shell at /pay/[tier]/
            [cadence]. */}
        <Link
          href="/pricing"
          className={cn(
            'inline-flex items-center gap-1.5 h-9 px-4 rounded-full',
            'bg-[var(--fg)] text-[var(--bg)]',
            'text-[12.5px] font-semibold tracking-tight',
            'hover:opacity-90 transition-opacity',
          )}
        >
          {t('exhaustedBanner.upgradeCta')}
        </Link>
        {IS_DEV && (
          <button
            type="button"
            onClick={onReset}
            className="text-[11.5px] text-[var(--fg-3)] hover:text-[var(--fg)] underline-offset-4 hover:underline transition-colors"
          >
            {t('exhaustedBanner.resetDev')}
          </button>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Error parsing ─────────────────────────── */

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
