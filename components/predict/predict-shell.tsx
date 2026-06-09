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

import dynamic from 'next/dynamic';
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
import { ChatBubble } from '@/components/predict/chat-bubble';
import { CoinIcon } from '@/components/ui/coin-icon';
import { Link } from '@/i18n/navigation';
import { WalletAuthButton } from '@/components/auth/wallet-auth-button';
import { cn } from '@/lib/utils';
import type { TickerEntry } from '@/lib/types';
import { loadRecents, pushRecent, clearRecents } from './recents-store';
import {
  IconChat,
  IconClose,
  IconHelp,
  IconHistory,
  IconLibrary,
  IconLock,
  IconMenu,
  IconPaperclip,
  IconPlus,
  IconSend,
  IconSettings,
  IconTools,
} from './predict-icons';
import { SlashPalette } from './slash-palette';

const SolanaWalletAdapter = dynamic(
  () => import('@/components/wallet/wallet-provider'),
  { ssr: false, loading: () => null },
);

interface QuotaState {
  connected: boolean;
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
  subscribed?: boolean;
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

/**
 * Polymarket-style prediction CTAs. Each card opens a directional
 * call on the named symbol over the given horizon. The coin icon
 * pulls from CoinCap's CDN via `<CoinIcon>`.
 */
interface QuickAction {
  symbol: string;
  name: string;
  horizon: string;
}

const QUICK_ACTIONS: ReadonlyArray<QuickAction> = [
  { symbol: 'BTC', name: 'Bitcoin', horizon: '4h' },
  { symbol: 'ETH', name: 'Ethereum', horizon: '1h' },
  { symbol: 'SOL', name: 'Solana', horizon: '1d' },
  { symbol: 'TON', name: 'Toncoin', horizon: '4h' },
];

/* ─────────────────────────── Shell ─────────────────────────── */

export function PredictShell({ tickers }: { tickers: readonly TickerEntry[] }) {
  // autoConnect intentionally OFF.
  //
  // The wallet-adapter library's autoConnect=true issues a silent
  // `connect({ silent: true })` on mount. That silent call leaves the
  // Phantom adapter in an intermediate state that swallows the next
  // explicit `connect()` from the selector modal — the extension popup
  // never appears (manifesting as "Open Phantom to approve" stuck
  // forever, both on Chrome and Brave).
  //
  // The connect flow inside `wallet-connect-flow.tsx` is built around
  // `autoConnect=false` (its comment in Step 1 explicitly notes this).
  // Sharing one provider context across the shell + the modal requires
  // honouring that contract, so autoConnect stays off here.
  return (
    <SolanaWalletAdapter autoConnect={false}>
      <PredictShellInner tickers={tickers} />
    </SolanaWalletAdapter>
  );
}

function PredictShellInner({ tickers }: { tickers: readonly TickerEntry[] }) {
  const t = useTranslations('predict');

  const [input, setInput] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [recents, setRecents] = useState<ReturnType<typeof loadRecents>>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

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
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const signedIn = auth?.signedIn === true;
  const composerLocked =
    !signedIn || (!!quota?.exhausted && !quota?.subscribed);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/predict' }),
    [],
  );

  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport,
    onFinish: () => {
      void mutateQuota();
    },
  });

  useEffect(() => {
    setRecents(loadRecents());
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

  const isStreaming = status === 'streaming' || status === 'submitted';
  const isErrored = status === 'error';

  const submitPrompt = useCallback(
    (text: string): void => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming || composerLocked) return;
      sendMessage({ text: trimmed });
      setRecents(pushRecent(trimmed));
      setInput('');
      setDrawerOpen(false);
    },
    [isStreaming, composerLocked, sendMessage],
  );

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    submitPrompt(input);
  };

  const onNewChat = (): void => {
    setMessages([]);
    setInput('');
    setDrawerOpen(false);
    inputRef.current?.focus();
  };

  const onClearRecents = (): void => {
    clearRecents();
    setRecents([]);
  };

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
          recentsCount={recents.length}
          recents={recents}
          onPickRecent={(p) => submitPrompt(p)}
          onClearRecents={onClearRecents}
          onNewChat={onNewChat}
          signedIn={signedIn}
          wallet={auth?.wallet}
          quota={quota}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          className="hidden lg:flex"
        />

        {/* ─── Center column ─── */}
        <section className="relative flex flex-col h-full min-h-0 min-w-0 overflow-hidden border-l border-[var(--border)]">
          {/* Mobile-only top bar — drawer trigger only. The brand
              lives inside the drawer itself (per Pass 25 spec), so
              this row stays minimal on the main chat view. */}
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
              <Welcome onPick={submitPrompt} tickers={tickers} />
            ) : (
              <div className="mx-auto max-w-[860px] w-full px-4 sm:px-6 py-6 flex flex-col gap-6">
                {messages.map((m) => (
                  <ChatBubble
                    key={m.id}
                    message={m}
                    streaming={isStreaming && m.id === lastAssistantId}
                  />
                ))}
                {isErrored && error && (
                  <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[12px] text-[var(--fg-2)]">
                    {parseErrorMessage(error)}
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
            <ChatTopics onPick={submitPrompt} />
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
                <ExhaustedBanner onReset={onInlineReset} />
              ) : (
                <Composer
                  inputRef={inputRef}
                  value={input}
                  onChange={setInput}
                  onSubmit={onSubmit}
                  isStreaming={isStreaming}
                  placeholder={t('shell.composer.placeholder')}
                  sendLabel={t('send')}
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
          recentsCount={recents.length}
          recents={recents}
          onPickRecent={(p) => {
            submitPrompt(p);
            setDrawerOpen(false);
          }}
          onClearRecents={onClearRecents}
          onNewChat={onNewChat}
          signedIn={signedIn}
          wallet={auth?.wallet}
          quota={quota}
        />
      )}
    </div>
  );
}


/* ─────────────────────────── Wallet gate ─────────────────────────── */

function WalletGate() {
  const t = useTranslations('predict.gate');
  const tShell = useTranslations('predict.shell');
  return (
    <div className="mx-auto max-w-[640px] w-full px-4 sm:px-6 py-8 sm:py-16 lg:py-24 flex flex-col items-center gap-6 sm:gap-8 text-center">
      <span
        aria-hidden
        className={cn(
          'inline-flex h-14 w-14 items-center justify-center',
          'rounded-2xl border border-[var(--border)]',
          'bg-[var(--surface-2)] text-[var(--fg)]',
          'vz-rise',
        )}
      >
        <IconLock size={20} />
      </span>

      <div className="flex flex-col gap-3">
        <h2 className="text-[28px] sm:text-[36px] font-semibold tracking-tight leading-[1.05] text-[var(--fg)] text-balance">
          {t('title')}
        </h2>
        <p className="text-[14px] leading-relaxed text-[var(--fg-2)] max-w-[48ch] mx-auto">
          {t('body')}
        </p>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 w-full max-w-[420px] text-left vz-rise" style={{ animationDelay: '120ms' }}>
        <GatePerk label={t('perk1')} />
        <GatePerk label={t('perk2')} />
        <GatePerk label={t('perk3')} />
        <GatePerk label={t('perk4')} />
      </ul>

      <p className="mono tabular text-[10.5px] uppercase tracking-[0.16em] text-[var(--fg-3)]">
        {tShell('composer.footer')}
      </p>
    </div>
  );
}

function WalletGateMini({ onSignedIn }: { onSignedIn: () => void }) {
  const t = useTranslations('predict.gate');
  useEffect(() => {
    const id = window.setInterval(onSignedIn, 6_000);
    return () => window.clearInterval(id);
  }, [onSignedIn]);

  return (
    <div className="flex items-center gap-3 vz-rise">
      <IconLock size={14} className="text-[var(--fg-3)] shrink-0" />
      <p className="flex-1 text-[13px] text-[var(--fg-2)] min-w-0">
        {t('composerHint')}
      </p>
      <div className="shrink-0">
        {/* Open the same selector modal the navbar uses, but signal
            that an outer wallet provider is already mounted (we're
            inside `<SolanaWalletAdapter>` on /predict). The modal
            then SKIPS its own LazyWalletAdapter mount and runs the
            connect flow inside the existing provider context — Phantom
            actually pops the extension instead of hanging on
            "Open Phantom to approve". */}
        <WalletAuthButton hasProvider={true} useModal={true} />
      </div>
    </div>
  );
}

function GatePerk({ label }: { label: string }) {
  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden
        className={cn(
          'mt-0.5 inline-flex h-4 w-4 items-center justify-center shrink-0',
          'rounded-full border border-[var(--border-hi)] bg-[var(--surface-2)] text-[var(--fg)]',
        )}
      >
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden>
          <path
            d="M1.5 4.5L3.5 6.5L7.5 2.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="text-[12.5px] text-[var(--fg-2)] leading-snug">
        {label}
      </span>
    </li>
  );
}

/* ─────────────────────────── Left rail ─────────────────────────── */

function LeftRail({
  search,
  onSearch,
  recentsCount,
  recents,
  onPickRecent,
  onClearRecents,
  onNewChat,
  signedIn,
  wallet,
  quota,
  collapsed = false,
  onToggleCollapse,
  embedded = false,
  className,
}: {
  search: string;
  onSearch: (v: string) => void;
  recentsCount: number;
  recents: ReturnType<typeof loadRecents>;
  onPickRecent: (prompt: string) => void;
  onClearRecents: () => void;
  onNewChat: () => void;
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
}) {
  const t = useTranslations('predict');
  const filteredRecents = useMemo(
    () =>
      search.trim()
        ? recents.filter((r) =>
            r.prompt.toLowerCase().includes(search.trim().toLowerCase()),
          )
        : recents,
    [recents, search],
  );

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
            href="/"
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
          <NavButton
            icon={<IconHistory size={collapsed ? 20 : 17} />}
            label={t('shell.recents.label')}
            meta={recentsCount > 0 ? String(recentsCount) : undefined}
            collapsed={collapsed}
          />
          <NavButton
            icon={<IconTools size={collapsed ? 20 : 17} />}
            label={t('shell.nav.tools')}
            collapsed={collapsed}
          />
          <NavButton
            icon={<IconLibrary size={collapsed ? 20 : 17} />}
            label={t('shell.nav.library')}
            meta={t('shell.nav.libraryHint')}
            collapsed={collapsed}
          />
        </nav>

        {/* Recents */}
        {!collapsed && recentsCount > 0 && (
          <div className="mt-5 flex flex-col gap-1">
            <div className="flex items-center justify-between px-3">
              <span className="text-[10.5px] uppercase tracking-[0.16em] text-[var(--fg-3)] font-semibold">
                {t('shell.recents.label')}
              </span>
              <button
                type="button"
                onClick={onClearRecents}
                className="text-[10px] text-[var(--fg-3)] hover:text-[var(--fg)] transition-colors"
              >
                {t('shell.recents.clear')}
              </button>
            </div>
            <ul className="flex flex-col gap-0.5">
              {filteredRecents.slice(0, 8).map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onPickRecent(r.prompt)}
                    className={cn(
                      'group w-full flex items-center gap-2 text-left',
                      'px-3 py-1.5 rounded-md',
                      'text-[12px] text-[var(--fg-2)] truncate',
                      'hover:bg-[var(--surface-2)] hover:text-[var(--fg)]',
                      'transition-colors',
                    )}
                    title={r.prompt}
                  >
                    <span aria-hidden className="text-[var(--fg-3)]">
                      <IconDotSmall />
                    </span>
                    <span className="truncate">{r.prompt}</span>
                  </button>
                </li>
              ))}
            </ul>
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
        <Identity signedIn={signedIn} wallet={wallet} collapsed={collapsed} />
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

function Identity({
  signedIn,
  wallet,
  collapsed = false,
}: {
  signedIn: boolean;
  wallet: string | undefined;
  collapsed?: boolean;
}) {
  const t = useTranslations('predict.shell');
  const tAuth = useTranslations('auth');
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<DropdownPhase>('closed');
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

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
            'absolute z-50 min-w-[180px]',
            collapsed
              ? 'left-full ml-2 bottom-0 origin-bottom-left'
              : 'left-0 right-0 bottom-full mb-1 origin-bottom',
            'rounded-lg border border-[var(--border)] bg-[var(--surface)]',
            'p-1',
            // Tween — opacity + a small lift toward the trigger. No
            // shadow, no glow; the border + surface contrast carry
            // the depth.
            'transition-[opacity,transform] duration-150 ease-out',
            isVisible
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 translate-y-1 pointer-events-none',
          )}
        >
          <DropdownItem
            icon={<IconSettings size={15} />}
            label={t('settings')}
            onClick={() => setOpen(false)}
          />
          <DropdownItem
            icon={<IconHelp size={15} />}
            label={t('help')}
            onClick={() => setOpen(false)}
          />
          {signedIn && (
            <DropdownLink
              href="/account"
              icon={<IconUser size={15} />}
              label={tAuth('viewProfile')}
              onClick={() => setOpen(false)}
            />
          )}
          {signedIn && (
            <DropdownItem
              icon={<IconSignOut size={15} />}
              label={tAuth('signOut')}
              onClick={() => void onSignOut()}
            />
          )}
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
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={dropdownItemClass}
    >
      <span aria-hidden className="text-[var(--fg-3)] group-hover:text-[var(--fg)] transition-colors">
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
  recentsCount,
  recents,
  onPickRecent,
  onClearRecents,
  onNewChat,
  signedIn,
  wallet,
  quota,
}: {
  onClose: () => void;
  search: string;
  onSearch: (v: string) => void;
  recentsCount: number;
  recents: ReturnType<typeof loadRecents>;
  onPickRecent: (prompt: string) => void;
  onClearRecents: () => void;
  onNewChat: () => void;
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
            href="/"
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
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          <LeftRail
            search={search}
            onSearch={onSearch}
            recentsCount={recentsCount}
            recents={recents}
            onPickRecent={onPickRecent}
            onClearRecents={onClearRecents}
            onNewChat={onNewChat}
            signedIn={signedIn}
            wallet={wallet}
            quota={quota}
            embedded
            className="flex h-full border-0 p-0 bg-transparent shadow-none backdrop-blur-none"
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
  isStreaming,
  placeholder,
  sendLabel,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  isStreaming: boolean;
  placeholder: string;
  sendLabel: string;
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
        // Minimalist chrome — translucent surface that lifts to a
        // proper surface tile when focused. Single hairline border
        // that picks up contrast on focus. No glow, no halo, no inset
        // highlight: the border darkening alone signals focus.
        'relative flex items-end gap-1.5',
        'rounded-3xl px-3 py-2',
        'bg-[color-mix(in_oklab,var(--surface)_75%,transparent)]',
        'backdrop-blur-sm',
        'border border-[var(--border)]',
        'focus-within:bg-[var(--surface)]',
        'focus-within:border-[var(--fg)]',
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
  prompt: string;
  /** When set, the chip renders `<CoinIcon symbol={ticker}>` as the
   *  prefix. Used for majors so the chip reads as a directional CTA on
   *  that coin. */
  ticker?: string;
  /** Otherwise, an inline mono SVG drawn by `<TopicIcon kind={icon}>`. */
  icon?: TopicIconKind;
}

/**
 * Vizzor-native head — these are the engine's first-class concepts
 * (conviction tiers, whale-confirmed flow, just-resolved receipts) not
 * generic Polymarket-style "Hot / New" labels.
 */
const TOPICS_HEAD: ReadonlyArray<TopicSpec> = [
  { id: 'high-conviction', label: 'High conviction', icon: 'spark', prompt: 'Show me current high-conviction predictions' },
  { id: 'whale', label: 'Whale flow', icon: 'wave', prompt: 'Recent whale-confirmed signals' },
  { id: 'resolved', label: 'Just resolved', icon: 'check', prompt: 'Show me just-resolved receipts' },
];

/**
 * Body — broadened beyond pure-crypto in the Polymarket spirit. The
 * engine is crypto-native, but the *catalysts* it tracks span macro,
 * politics, ETFs, and stocks (MSTR / COIN / NVDA correlation). The
 * chip set surfaces those catalysts as first-class entries instead of
 * burying them under generic "trends".
 */
const TOPICS_BODY: ReadonlyArray<TopicSpec> = [
  // Majors — direct prediction prompts via the engine's `<SYM> <H>` shape
  { id: 'btc', label: 'Bitcoin', ticker: 'BTC', prompt: 'BTC 4h' },
  { id: 'eth', label: 'Ethereum', ticker: 'ETH', prompt: 'ETH 4h' },
  { id: 'sol', label: 'Solana', ticker: 'SOL', prompt: 'SOL 4h' },
  { id: 'ton', label: 'Toncoin', ticker: 'TON', prompt: 'TON 4h' },
  // Vizzor-internal surfaces
  { id: 'wr', label: 'Tracked WR', icon: 'target', prompt: '/wr' },
  { id: 'precisions', label: 'Receipts', icon: 'receipt', prompt: '/precisions' },
  { id: 'calibration', label: 'Calibration', icon: 'gauge', prompt: 'Show me per-horizon calibration trust' },
  // Crypto-native sectors
  { id: 'defi', label: 'DeFi', icon: 'liquid', prompt: 'DeFi sector update' },
  { id: 'l2', label: 'L2s', icon: 'stack', prompt: 'Layer 2 ecosystem update' },
  { id: 'memes', label: 'Memes', icon: 'dice', prompt: 'Top memecoins trending now' },
  { id: 'ai', label: 'AI agents', icon: 'chip', prompt: 'AI agents in crypto' },
  { id: 'depin', label: 'DePIN', icon: 'mesh', prompt: 'DePIN trends and tokens' },
  { id: 'rwa', label: 'RWA', icon: 'building', prompt: 'Real-world asset tokens' },
  { id: 'restaking', label: 'Restaking', icon: 'cycle', prompt: 'Restaking trends and yields' },
  { id: 'pre-news', label: 'Pre-news', icon: 'radar', prompt: 'Pre-news signals firing now' },
  // Polymarket-style catalysts — broader catalysts that move crypto
  { id: 'macro', label: 'Macro', icon: 'globe', prompt: 'Macro outlook — Fed, DXY, rates, and crypto impact' },
  { id: 'etfs', label: 'ETF flows', icon: 'bars', prompt: 'Latest BTC and ETH spot ETF net flows' },
  { id: 'regulation', label: 'Regulation', icon: 'shield', prompt: 'Crypto regulation watch — SEC, MiCA, Korea' },
  { id: 'stables', label: 'Stables', icon: 'anchor', prompt: 'Stablecoin supply changes and depeg risk' },
  { id: 'geopolitics', label: 'Geopolitics', icon: 'flag', prompt: 'Geopolitics and crypto — sanctions, capital flight' },
  { id: 'stocks', label: 'Stocks tape', icon: 'bars', prompt: 'Crypto-correlated stocks — MSTR, COIN, NVDA' },
];

function ChatTopics({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <nav
      aria-label="Prompt suggestions"
      className="relative shrink-0"
    >
      <ul
        className={cn(
          'flex items-center gap-1.5 overflow-x-auto',
          'mx-auto max-w-[860px] w-full px-3 sm:px-6 pt-2',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
      >
        {TOPICS_HEAD.map((t, i) => (
          <li key={t.id} className="shrink-0">
            <TopicChip topic={t} onPick={onPick} highlighted={i === 0} />
          </li>
        ))}
        <li
          aria-hidden
          className="shrink-0 h-4 w-px bg-[var(--border)] mx-1"
        />
        {TOPICS_BODY.map((t) => (
          <li key={t.id} className="shrink-0">
            <TopicChip topic={t} onPick={onPick} />
          </li>
        ))}
      </ul>

      {/* Subtle edge fades — sit on the px-3/sm:px-6 inset so the fade
          starts where the chips do. */}
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
    </nav>
  );
}

function TopicChip({
  topic,
  onPick,
  highlighted = false,
}: {
  topic: TopicSpec;
  onPick: (prompt: string) => void;
  highlighted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(topic.prompt)}
      className={cn(
        'inline-flex items-center gap-1.5',
        'h-7 px-2.5 rounded-full',
        'text-[12.5px] font-medium leading-none whitespace-nowrap',
        'transition-colors',
        highlighted
          ? 'bg-[var(--fg)] text-[var(--bg)]'
          : 'border border-[var(--border)] text-[var(--fg-2)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] hover:border-[var(--border-hi)]',
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
      <span>{topic.label}</span>
    </button>
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

/* ─────────────────────────── Welcome ─────────────────────────── */

function Welcome({
  onPick,
  tickers,
}: {
  onPick: (prompt: string) => void;
  tickers: readonly TickerEntry[];
}) {
  const t = useTranslations('predict.shell.welcome');
  // Index by symbol so each existing prediction tile can show its own
  // live spot price + 24h delta inline. No extra row of cards — the
  // ticker data is folded into the prediction CTA itself.
  const tickerBySymbol = new Map<string, TickerEntry>();
  for (const tk of tickers) {
    tickerBySymbol.set(tk.symbol.toUpperCase(), tk);
  }
  return (
    <div className="mx-auto max-w-[760px] w-full px-4 sm:px-6 py-12 sm:py-16 lg:py-24 flex flex-col items-center gap-8 sm:gap-10 text-center">
      <div className="flex flex-col gap-3 vz-rise" style={{ animationDelay: '0ms' }}>
        <h2 className="display text-[var(--fg)] text-balance text-[28px] sm:text-[38px] lg:text-[44px] leading-[1.05] tracking-tight font-semibold max-w-[20ch] mx-auto">
          {t('title')}
        </h2>
        <p className="text-[14.5px] leading-relaxed text-[var(--fg-2)] max-w-[52ch] mx-auto">
          {t('sub')}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-[560px]">
        {QUICK_ACTIONS.map((qa, idx) => {
          const prompt = `${qa.symbol} ${qa.horizon}`;
          const tk = tickerBySymbol.get(qa.symbol);
          const up = tk ? tk.changePct >= 0 : true;
          return (
            <button
              key={qa.symbol}
              type="button"
              onClick={() => onPick(prompt)}
              style={{ animationDelay: `${120 + idx * 90}ms` }}
              className={cn(
                'group flex flex-col items-stretch text-left',
                'rounded-2xl border border-[var(--border)] bg-[var(--surface)]',
                'p-4 gap-3',
                'hover:border-[var(--fg)] hover:bg-[var(--surface-2)]',
                'hover:-translate-y-0.5 active:translate-y-0',
                'transition-[border-color,background-color,transform] duration-200 ease-out',
                'vz-rise',
              )}
            >
              {/* Top row: coin icon + asset name + horizon chip */}
              <span className="flex items-center gap-3 min-w-0">
                <span className="relative inline-flex shrink-0">
                  <CoinIcon symbol={qa.symbol} size={36} />
                  {tk && (
                    <span
                      aria-hidden
                      className={cn(
                        'absolute -bottom-0.5 -right-0.5 inline-flex h-2 w-2 rounded-full',
                        'bg-[var(--fg)] ring-1 ring-[var(--bg)]',
                        'motion-safe:animate-pulse',
                      )}
                    />
                  )}
                </span>
                <span className="min-w-0 flex flex-col leading-tight flex-1">
                  <span className="text-[14px] font-semibold text-[var(--fg)] truncate">
                    {qa.name}
                  </span>
                  {tk ? (
                    <span className="mono tabular text-[11px] text-[var(--fg-3)] truncate flex items-center gap-1.5">
                      <span>{formatPrice(tk.price)}</span>
                      <span aria-hidden className="text-[var(--fg-3)]/60">·</span>
                      <span className="inline-flex items-center gap-0.5 text-[var(--fg-2)]">
                        <IconArrowTick up={up} />
                        {formatPct(tk.changePct)}
                      </span>
                    </span>
                  ) : (
                    <span className="mono tabular text-[11px] text-[var(--fg-3)] truncate">
                      {qa.symbol}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    'mono tabular text-[10.5px] uppercase tracking-[0.14em]',
                    'inline-flex items-center rounded-md border border-[var(--border)] px-2 py-1',
                    'text-[var(--fg-2)] shrink-0',
                  )}
                >
                  {qa.horizon}
                </span>
              </span>

              {/* Predict CTA — liquid-glass capsule. Translucent fg
                  surface + light backdrop-blur + a 1px inset highlight
                  along the top edge to read as a glass bubble. No drop
                  shadow, no glow — keeps it quiet. */}
              <span
                className={cn(
                  'inline-flex items-center justify-center gap-1.5',
                  'rounded-full h-10 px-4',
                  'bg-[color-mix(in_oklab,var(--fg)_88%,transparent)]',
                  'text-[var(--bg)] backdrop-blur-md',
                  'shadow-[0_1px_0_color-mix(in_oklab,var(--bg)_22%,transparent)_inset]',
                  'text-[13px] font-semibold tracking-tight',
                  'group-hover:bg-[var(--fg)] group-active:scale-[0.98]',
                  'transition-[background-color,transform]',
                )}
              >
                <span>Predict {qa.symbol}</span>
                <span aria-hidden className="inline-flex translate-x-0 group-hover:translate-x-0.5 transition-transform">
                  →
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── Ticker helpers ─────────────────────────── */

function IconArrowTick({ up }: { up: boolean }) {
  return (
    <svg
      width="8"
      height="8"
      viewBox="0 0 8 8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ transform: up ? 'rotate(0deg)' : 'rotate(180deg)' }}
    >
      <path d="M4 1.5v5" />
      <path d="M1.5 4L4 1.5L6.5 4" />
    </svg>
  );
}

function formatPrice(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) {
    return `$${Math.round(n).toLocaleString('en-US')}`;
  }
  if (n >= 1) {
    return `$${n.toFixed(2)}`;
  }
  if (n >= 0.01) {
    return `$${n.toFixed(3)}`;
  }
  return `$${n.toPrecision(2)}`;
}

function formatPct(d: number): string {
  if (!Number.isFinite(d)) return '—';
  const pct = d * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/* ─────────────────────────── Exhausted banner ─────────────────────────── */

function ExhaustedBanner({ onReset }: { onReset: () => void }) {
  const t = useTranslations('predict');
  return (
    <div className="flex flex-col gap-2 px-4 py-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] vz-rise">
      <p className="text-[11.5px] uppercase tracking-[0.14em] font-semibold text-[var(--fg)]">
        {t('exhaustedBanner.label')}
      </p>
      <p className="text-[13px] leading-relaxed text-[var(--fg-2)]">
        {t('exhaustedBanner.body')}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <Link
          href="/pricing"
          className={cn(
            'inline-flex items-center gap-1.5 h-9 px-4 rounded-full',
            'bg-[var(--fg)] text-[var(--bg)]',
            'text-[12.5px] font-semibold tracking-tight',
            'hover:opacity-90 transition-opacity',
          )}
        >
          {t('subscribe.cta')}
        </Link>
        <a
          href="https://t.me/vizzorai_bot"
          target="_blank"
          rel="noopener"
          className={cn(
            'inline-flex items-center gap-1.5 h-9 px-4 rounded-full',
            'border border-[var(--border-hi)] text-[var(--fg)]',
            'text-[12.5px] font-semibold tracking-tight',
            'hover:bg-[var(--surface-2)] transition-colors',
          )}
        >
          {t('exhaustedBanner.telegramCta')}
        </a>
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
