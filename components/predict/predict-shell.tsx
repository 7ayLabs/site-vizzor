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
import { Link } from '@/i18n/navigation';
import { WalletAuthButton } from '@/components/auth/wallet-auth-button';
import { cn } from '@/lib/utils';
import { loadRecents, pushRecent, clearRecents } from './recents-store';
import {
  IconActivity,
  IconChat,
  IconChevronRight,
  IconClose,
  IconHelp,
  IconHistory,
  IconLibrary,
  IconLock,
  IconMenu,
  IconPaperclip,
  IconPlus,
  IconPredict,
  IconPrice,
  IconSend,
  IconSettings,
  IconTools,
  IconWinRate,
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

interface QuickAction {
  id: string;
  hint: string;
  prompt: string;
  Icon: typeof IconPredict;
}

const QUICK_ACTIONS: ReadonlyArray<QuickAction> = [
  { id: 'predict', hint: 'BTC 4h', prompt: 'BTC 4h', Icon: IconPredict },
  { id: 'wr', hint: '/wr', prompt: '/wr', Icon: IconWinRate },
  { id: 'precisions', hint: '/precisions', prompt: '/precisions', Icon: IconActivity },
  { id: 'price', hint: '/price BTC', prompt: '/price BTC', Icon: IconPrice },
];

/* ─────────────────────────── Shell ─────────────────────────── */

export function PredictShell() {
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
      <PredictShellInner />
    </SolanaWalletAdapter>
  );
}

function PredictShellInner() {
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
              <Welcome onPick={submitPrompt} />
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

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 w-full max-w-[420px] text-left">
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
    <div className="flex items-center gap-3">
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
        <Check />
      </span>
      <span className="text-[12.5px] text-[var(--fg-2)] leading-snug">
        {label}
      </span>
    </li>
  );
}

function Check() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden>
      <path
        d="M1.5 4.5L3.5 6.5L7.5 2.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
  const t = useTranslations('predict.shell.composer');
  const [paletteOpen, setPaletteOpen] = useState(false);

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

  return (
    <form
      onSubmit={onSubmit}
      className={cn(
        'relative flex items-center gap-2',
        // Stronger surface contrast so the input reads as an input
        // (the previous bg-surface was visually indistinguishable
        // from the page bg in dark mode).
        'rounded-2xl border border-[var(--border-hi)] bg-[var(--surface-2)]',
        'shadow-[0_1px_0_color-mix(in_oklab,var(--fg)_4%,transparent)_inset]',
        'focus-within:border-[var(--fg)]',
        'transition-colors',
        'pl-4 pr-2 py-2.5',
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
          'text-[14px] text-[var(--fg)] leading-relaxed placeholder:text-[var(--fg-3)]',
          'max-h-[140px] py-1 min-w-0',
        )}
      />

      <button
        type="submit"
        disabled={isStreaming || value.trim().length === 0}
        aria-label={sendLabel}
        className={cn(
          // 10×10 on mobile = 40px touch target; tightens to 9×9 on
          // sm+ where pointer accuracy is higher.
          'shrink-0 inline-flex h-10 w-10 sm:h-9 sm:w-9 items-center justify-center rounded-full',
          'bg-[var(--fg)] text-[var(--bg)]',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          'hover:opacity-90 transition-opacity',
        )}
      >
        <IconSend size={14} />
      </button>
    </form>
  );
}

/* ─────────────────────────── Welcome ─────────────────────────── */

function Welcome({ onPick }: { onPick: (prompt: string) => void }) {
  const t = useTranslations('predict.shell.welcome');
  const tQuick = useTranslations('predict.shell.quickActions');
  return (
    <div className="mx-auto max-w-[760px] w-full px-4 sm:px-6 py-12 sm:py-16 lg:py-24 flex flex-col items-center gap-8 sm:gap-10 text-center">
      <div className="flex flex-col gap-3">
        <h2 className="display text-[var(--fg)] text-balance text-[28px] sm:text-[38px] lg:text-[44px] leading-[1.05] tracking-tight font-semibold max-w-[20ch] mx-auto">
          {t('title')}
        </h2>
        <p className="text-[14.5px] leading-relaxed text-[var(--fg-2)] max-w-[52ch] mx-auto">
          {t('sub')}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-[560px]">
        {QUICK_ACTIONS.map((qa) => {
          const Icon = qa.Icon;
          return (
            <button
              key={qa.id}
              type="button"
              onClick={() => onPick(qa.prompt)}
              className={cn(
                'group flex items-center justify-between gap-3 text-left',
                'rounded-2xl border border-[var(--border)] bg-[var(--surface)]',
                'px-4 py-4',
                'hover:border-[var(--fg)] hover:bg-[var(--surface-2)]',
                'transition-colors',
              )}
            >
              <span className="inline-flex items-center gap-3 min-w-0">
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex h-10 w-10 items-center justify-center rounded-xl',
                    'bg-[var(--surface-2)] text-[var(--fg)]',
                    'border border-[var(--border-hi)] group-hover:border-[var(--fg)]',
                    'transition-colors',
                  )}
                >
                  <Icon size={18} />
                </span>
                <span className="min-w-0 flex flex-col leading-tight">
                  <span className="text-[13.5px] font-semibold text-[var(--fg)] truncate">
                    {tQuick(`${qa.id}.label`)}
                  </span>
                  <span className="mono tabular text-[11px] text-[var(--fg-3)] truncate">
                    {qa.hint}
                  </span>
                </span>
              </span>
              <span
                aria-hidden
                className={cn(
                  'inline-flex h-6 w-6 items-center justify-center shrink-0',
                  'rounded-full border border-[var(--border)]',
                  'text-[var(--fg-3)] group-hover:text-[var(--fg)] group-hover:border-[var(--fg)]',
                  'transition-colors',
                )}
              >
                <IconChevronRight size={11} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── Exhausted banner ─────────────────────────── */

function ExhaustedBanner({ onReset }: { onReset: () => void }) {
  const t = useTranslations('predict');
  return (
    <div className="flex flex-col gap-2 px-4 py-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]">
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
