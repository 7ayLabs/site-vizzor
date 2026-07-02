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
import { TOP_20, TOP_20_BY_SYMBOL } from '@/lib/coin-meta';
import type { TickerEntry } from '@/lib/types';
import { useTicker, useExtraTickers } from '@/lib/api';
import { ChatBubble } from '@/components/predict/chat-bubble';
import {
  renderTextWithInlineCoinIcons,
  type InlineTickerChipEntry,
} from '@/components/predict/inline-ticker-chip';
import { DirectoryPicker } from '@/components/predict/directory-picker';
import { CapabilityTray } from '@/components/predict/capability-tray';
import { IntentChatCard } from '@/components/predict/intent-chat-card';
import { CapabilityActionModal } from '@/components/predict/capability-action-modal';
import { useCapabilities } from '@/lib/capabilities/use-capabilities';
import { useNotifications } from '@/lib/notifications/use-notifications';
import { useAlertTriggerWatch } from '@/lib/notifications/use-alert-trigger-watch';
import {
  ALL_CAP_IDS,
  parsePendingIntent,
  type CapId,
  type PendingIntent,
} from '@/lib/capabilities/intent';
import { parseTradePlan, type TradePlan } from '@/lib/trade/trade-plan';
import { parseTradePlansFromProse } from '@/lib/trade/parse-plan-from-prose';
import { TradePlanCard } from '@/components/predict/trade-plan-card';
import {
  buildCommandTemplate,
  COMMAND_KEYWORD,
  parseCommand,
  type ParsedCommand,
  stripCommand,
} from '@/lib/capabilities/command-syntax';
import { CoinIcon } from '@/components/ui/coin-icon';
import { Link } from '@/i18n/navigation';
import { WalletAuthButton } from '@/components/auth/wallet-auth-button';
import { useRouter } from '@/i18n/navigation';
import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils';
import { isWalletAddressToken } from '@/lib/utils/wallet-detect';
import {
  useConversations,
  WorkflowsBlockingDeleteError,
  type ConversationSummary,
} from './use-conversations';
import {
  ArrowLeftRight,
  ArrowUpRight,
  Boxes,
  Check,
  Wallet,
} from 'lucide-react';
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
  MeasuringStrategy,
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
  // Token pills selected from the carousel — each pill renders inside
  // the composer as a low-opacity icon + ticker chip with an "×".
  // On submit the symbols are concatenated ahead of the typed text
  // ("BTC ETH " + "4h con funding") and the pill row clears. Carousel
  // chips without a `ticker` field (high-conviction, whale flow, …)
  // bypass this and still drop their canned prompt straight into
  // the textarea like before.
  const [tokenPills, setTokenPills] = useState<ReadonlyArray<string>>([]);
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
  // Note: the `vizzor-tour-finished` listener that used to live here
  // was moved into MobileDrawer (v0.5.22) so the close plays the
  // slide-out keyframe instead of snapping the drawer unmounted.
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

  const signedIn = auth?.signedIn === true;
  const composerLocked =
    !signedIn || (!!quota?.exhausted && !quota?.subscribed);

  // Agent-payment capability preferences. Signed-in wallets fetch the
  // enabled set + spend caps once and cache for 15s; unauthenticated
  // sessions skip the request and land on the safe default (tray
  // locked). The tray only becomes tappable when a wallet has
  // explicitly enabled a capability in settings AND accepted the
  // current TOS version — enforced server-side too, this is just the
  // UI mirror so a locked icon reads correctly.
  const capabilities = useCapabilities({ enabled: signedIn });
  // v0.5.2 — notifications feed. `counts` powers the Alerts/Workflows
  // badges on this shell's own LeftRail so the predict surface (which
  // suppresses ProductSidebar in favor of its 3-column layout) still
  // shows the same unread numbers a user sees on /app/workflows or
  // /app/account. `markAllRead` clears the Alerts bucket the moment
  // the user opens the alerts drawer.
  const {
    counts: notifCounts,
    markAllRead: markAllNotifRead,
    refresh: refreshNotifications,
  } = useNotifications({ enabled: signedIn });
  useAlertTriggerWatch({
    enabled: signedIn,
    wallet: auth?.wallet,
    onNewTrigger: () => {
      void refreshNotifications();
    },
  });
  // Tier gate uses ONLY the quota API — that's the same source that
  // powers the sidebar badge (Elite / Pro / Trial), so the tray can
  // never disagree with the badge the user is looking at. We
  // deliberately ignore `capabilities.tierLocked` here because that
  // response ships a `tier_locked: true` fallback while its SWR
  // fetches; using it would flash "locked" on modal-open for a
  // half-second before revalidation, which is what surfaced as the
  // "Upgrade to Pro" bug for Elite wallets. Server-side, /api/
  // capabilities/enabled + /api/execute-intent still refuse free
  // tier — this is UI-side only.
  const tierLocked = !signedIn || quota?.tier === 'free';
  // Currently-armed capabilities — flipped on when the action modal
  // produces a pending intent for that capability, so the tray icon
  // shows the breathing pulse until the intent is signed / rejected.
  // Session-only by design (reload does NOT carry armed state).
  const [armedCapabilities, setArmedCapabilities] = useState<Set<CapId>>(
    () => new Set<CapId>(),
  );
  // The enable-step modal is only shown when a wallet clicks a
  // capability icon that isn't enabled yet (or is tier-locked). If
  // the capability is already enabled the shell skips the modal
  // entirely and inserts the /transfer command template into the
  // composer — the draft lives inline in the textarea, not a form.
  const [openActionCap, setOpenActionCap] = useState<CapId | null>(null);
  // Which capability's create-intent POST is currently pending, if
  // any. Prevents double-submit and drives a subtle "settling…"
  // hint under the composer while the network call is inflight.
  const [commandInFlight, setCommandInFlight] = useState<CapId | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  // Refs used by the capability click handlers below. Populated by
  // effects further down so the callbacks stay stable — no
  // dependency on `capabilities.enabledSet` means the tray click
  // handler is created once and never invalidates the memoized
  // Composer subtree on capability revalidation.
  const capabilitiesStateRef = useRef<{
    tierLocked: boolean;
    enabledSet: ReadonlySet<CapId>;
  }>({ tierLocked: true, enabledSet: new Set() });
  const insertCommandTemplateRef = useRef<(cap: CapId) => void>(() => {});
  const removeCommandTemplateRef = useRef<(cap: CapId) => void>(() => {});
  const hasCapabilityCommandRef = useRef<(cap: CapId) => boolean>(
    () => false,
  );
  const openCapabilityAction = useCallback((cap: CapId) => {
    setCommandError(null);
    const cbState = capabilitiesStateRef.current;
    if (cbState.tierLocked || !cbState.enabledSet.has(cap)) {
      setOpenActionCap(cap);
      return;
    }
    // Toggle: a second click on an already-drafted capability clears
    // its command line from the textbox instead of appending another
    // one. Prevents "send 0.1 SOL → send 0.1 SOL → " stacking that a
    // repeated click used to produce.
    if (hasCapabilityCommandRef.current(cap)) {
      removeCommandTemplateRef.current(cap);
    } else {
      insertCommandTemplateRef.current(cap);
    }
  }, []);
  const onCapabilityEnabled = useCallback((cap: CapId) => {
    setOpenActionCap(null);
    insertCommandTemplateRef.current(cap);
  }, []);

  // v0.5.2 — user-confirmation bridge from the TradePlanCard's
  // Send-winnings row. Mints a pending intent (same code path the
  // composer's `send 0.1 SOL → <addr>` syntax uses) and surfaces
  // the IntentChatCard so the wallet prompt is the actual "sign to
  // confirm" moment. The engine correctly refuses to move funds
  // itself — this is how the user completes that same action with
  // an explicit signature.
  const onProceedsSend = useCallback(
    async (opts: {
      toAddr: string;
      amount: string;
      symbol: string;
    }): Promise<void> => {
      setCommandError(null);
      try {
        const res = await fetch('/api/capabilities/create-intent', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            capability: 'transfer',
            network: 'sol',
            to_addr: opts.toAddr,
            symbol: opts.symbol,
            amount: opts.amount,
            conversation_id: activeConversationId ?? null,
          }),
        });
        const data = (await res.json()) as
          | { ok: true; intent: PendingIntent }
          | { ok: false; reason?: string; detail?: string };
        if (!res.ok || data.ok === false) {
          const reason =
            data.ok === false ? (data.reason ?? 'errorGeneric') : 'errorGeneric';
          const detail = data.ok === false ? data.detail : undefined;
          setCommandError(detail ? `${reason}::${detail}` : reason);
          throw new Error(reason);
        }
        setArmedCapabilities((prev) => {
          const next = new Set(prev);
          next.add('transfer');
          return next;
        });
        setPendingIntent(data.intent);
      } catch (e) {
        // Rethrow so the ProceedsSend row can surface the error
        // inline while the shell also holds it in commandError for
        // the CommandStatus strip.
        throw e;
      }
    },
    [activeConversationId],
  );
  // Ref-backed remover so the callback stays stable (Composer memo)
  // while still seeing the latest `input` / `pendingIntent`. Body
  // wired below in a useEffect that mirrors the current shell state.
  const removeTokenPillRef = useRef<(sym: string) => void>(() => {});
  const onRemoveTokenPill = useCallback((sym: string) => {
    removeTokenPillRef.current(sym);
  }, []);
  // Keep the capability-state ref current so the stable click
  // handler above reads the latest tier + enabled-set at click time
  // without re-mounting the Composer subtree on every SWR poll.
  useEffect(() => {
    capabilitiesStateRef.current = {
      tierLocked,
      enabledSet: capabilities.enabledSet,
    };
  }, [tierLocked, capabilities.enabledSet]);
  // Same pattern for the template inserter — the latest `input`
  // determines whether we replace it or append on a new line. The
  // remover + drafted-detector share the same effect so all three
  // read a consistent snapshot of `input`.
  useEffect(() => {
    insertCommandTemplateRef.current = (cap: CapId) => {
      // The carousel-picked ticker drives the symbol in the template
      // (`send 0.1 BTC → ` when BTC is picked). Falls back to SOL
      // only when the tray somehow fires with no pick — the shell
      // otherwise hides the tray in that state.
      const symbol = tokenPills[0]?.toUpperCase();
      const template = buildCommandTemplate(cap, symbol);
      const prev = input.trim();
      const nextInput = prev.length > 0 ? `${prev}\n${template}` : template;
      setInput(nextInput);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        // Caret at the very end of the inserted template (right after
        // the arrow + trailing space) so the user's next keystroke
        // starts the recipient address. No selection highlight —
        // cursor lands as a normal blinking caret, and arrow keys
        // navigate freely from there.
        const caretPos = nextInput.length;
        el.setSelectionRange(caretPos, caretPos);
        // Nudge the browser to scroll the caret into view when the
        // textarea already carried prior lines above the fold.
        el.scrollTop = el.scrollHeight;
      });
    };
    // Detect: does `input` currently contain a command line for
    // this capability? Matches the keyword when it's at start-of-
    // string or preceded by whitespace, so incidental words like
    // "recommend" or "topping up my $auto reserves" don't false-
    // positive. Amount digit isn't required — partial commands
    // (just `send ` with nothing after) should still count as
    // "drafted" so a second click clears them.
    hasCapabilityCommandRef.current = (cap: CapId) => {
      const kw = COMMAND_KEYWORD[cap];
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?:^|\\s)${escaped}\\b`, 'i').test(input);
    };
    // Strip the command LINE for this capability from the current
    // input. Handles three shapes:
    //   1. Full match at start of a line: `send 0.1 SOL → 5oQ...`
    //   2. Partial template: `send 0.1 SOL → `
    //   3. Bare keyword: `send` (before the user typed anything)
    // The regex kills the whole segment from the keyword through
    // end-of-line, then collapses the resulting double newlines so
    // the residue reads cleanly.
    removeCommandTemplateRef.current = (cap: CapId) => {
      const kw = COMMAND_KEYWORD[cap];
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const stripLineRe = new RegExp(
        `(?:^|\\n)[ \\t]*${escaped}\\b[^\\n]*`,
        'gi',
      );
      const nextInput = input
        .replace(stripLineRe, '')
        .replace(/\n{2,}/g, '\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '');
      setInput(nextInput);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        const caretPos = nextInput.length;
        el.setSelectionRange(caretPos, caretPos);
      });
    };
  }, [input, tokenPills]);
  // Latest-input mirror + latest-pending-intent mirror populated by
  // the effect below. Refs let the removal cascade read them at
  // click time without a hard lexical dependency (pendingIntent is
  // declared further down inside the useChat block).
  const inputRef2 = useRef(input);
  const pendingIntentRef = useRef<PendingIntent | null>(null);
  useEffect(() => {
    inputRef2.current = input;
  }, [input]);
  // Cascade cleanup when a carousel pill is removed:
  //   1. drop it from `tokenPills`
  //   2. strip EVERY command in the input that referenced that
  //      symbol (users can insert multiple templates back-to-back)
  //   3. also nuke any partial/orphan templates for the same symbol
  //      even when the recipient isn't filled in yet
  //   4. clear the matching entries from `armedCapabilities`
  //   5. dismiss the pending intent modal if it was for that symbol
  // Rationale: the tray is gated on carousel picks, so removing the
  // gate should also revoke every downstream capability action for
  // that specific token — no orphaned "send 0.1 BTC → …" left in
  // the composer when BTC is no longer selected.
  useEffect(() => {
    removeTokenPillRef.current = (sym: string) => {
      const upper = sym.toUpperCase();
      setTokenPills((prev) => prev.filter((s) => s.toUpperCase() !== upper));
      let currentInput = inputRef2.current;
      const removedCaps = new Set<CapId>();
      // Loop: strip fully-formed commands until none match the symbol.
      // Bounded by a max iteration count to defend against a broken
      // parser regressing into an infinite match — belt-and-suspenders.
      for (let i = 0; i < 8; i++) {
        const parsed = parseCommand(currentInput);
        if (!parsed || parsed.symbol !== upper) break;
        currentInput = stripCommand(currentInput, parsed);
        removedCaps.add(parsed.capability);
      }
      // Also strip partial templates (`send 0.1 BTC → `) that the
      // user inserted but never finished — parseCommand rejects
      // those because the recipient is missing. Regex-scan for the
      // shell of a command carrying the removed symbol and delete
      // the whole line/segment.
      const PARTIAL_RE = new RegExp(
        `\\b(send|pay)\\s+\\d+(?:\\.\\d+)?\\s+${upper}\\s+(?:→|to)\\s*[^\\n]*`,
        'gi',
      );
      currentInput = currentInput
        .replace(PARTIAL_RE, (match) => {
          const kw = match.match(/^(send|pay)/i)?.[1]?.toLowerCase();
          if (kw === 'send') removedCaps.add('transfer');
          if (kw === 'pay') removedCaps.add('payment');
          return '';
        })
        .replace(/\n{2,}/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
      if (currentInput !== inputRef2.current) setInput(currentInput);
      if (removedCaps.size > 0) {
        setArmedCapabilities((prev) => {
          const next = new Set(prev);
          for (const c of removedCaps) next.delete(c);
          return next;
        });
      }
      const pi = pendingIntentRef.current;
      if (pi && pi.symbol === upper) {
        setPendingIntent(null);
      }
      // v0.5.1 — also clear a buffered (not-yet-visible) intent if
      // it targeted the ticker the user just removed. Prevents a
      // "surprise" sign card from mounting after the stream ends
      // for a workflow the user has already dismissed.
      setBufferedIntent((prev) => (prev && prev.symbol === upper ? null : prev));
    };
  }, []);

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

  // v0.5.0 — pending agent-payment intent surfaced from the engine.
  // When the /api/predict transform sees an `intent_required` SSE
  // event, it persists the row + re-emits a `data-intent-required`
  // stream chunk. The onData callback below catches it and drops
  // the parsed intent into state, which mounts the confirmation
  // modal. There is at most one pending intent per conversation
  // turn at a time — the modal is blocking until the user signs or
  // dismisses.
  const [pendingIntent, setPendingIntent] = useState<PendingIntent | null>(
    null,
  );
  // v0.5.1 — sequenced-reveal buffer. When the user submits a workflow
  // prompt (predict + send in the same turn), we mint the intent
  // immediately but hold it here until the assistant's prediction
  // response finishes streaming. That way the sign card doesn't
  // steal focus from an incomplete answer — Vizzor talks first, THEN
  // asks for a signature. Cleared on submit; promoted to
  // pendingIntent via the streaming-end effect below.
  const [bufferedIntent, setBufferedIntent] = useState<PendingIntent | null>(
    null,
  );
  // v0.5.2 Phase 1 — trade plans emitted by the engine land here.
  // Keyed by plan_id so the same turn can carry more than one (rare
  // but possible: "plan for SOL AND ETH"). Rendered in-thread as
  // TradePlanCards. Cleared per-conversation on chat switch.
  const [tradePlans, setTradePlans] = useState<Map<string, TradePlan>>(
    () => new Map(),
  );
  // Mirror latest pendingIntent onto the ref so the removal cascade
  // above can read it without a lexical dependency on the state.
  useEffect(() => {
    pendingIntentRef.current = pendingIntent;
  }, [pendingIntent]);

  const { messages, sendMessage, status, error, setMessages, stop } = useChat({
    transport,
    onFinish: () => {
      void mutateQuota();
    },
    onData: (part) => {
      // Data-part chunks arrive with `type: 'data-<name>'`. We
      // handle two kinds today: intent-required (v0.5.0 signing
      // handshake) and trade-plan (v0.5.2 phase-1 structured trade
      // plans). Anything else is ignored safely.
      if (part.type === 'data-intent-required') {
        const intent = parsePendingIntent(part.data);
        if (intent) setPendingIntent(intent);
        return;
      }
      if (part.type === 'data-trade-plan') {
        const plan = parseTradePlan(part.data);
        if (plan) {
          setTradePlans((prev) => {
            const next = new Map(prev);
            next.set(plan.plan_id, plan);
            return next;
          });
        }
      }
    },
  });

  // Derived: ordered array of trade plans for render + the cluster
  // label the Jupiter deep-link uses to gate the [OPEN JUPITER] link.
  // Ordering by issued_at so newer plans appear below older ones —
  // matches the natural reading order of the thread above.
  const tradePlansArr = useMemo(
    () =>
      Array.from(tradePlans.values()).sort(
        (a, b) => a.issued_at - b.issued_at,
      ),
    [tradePlans],
  );
  const tradePlanNetwork: 'mainnet-beta' | 'devnet' | 'testnet' = useMemo(() => {
    const net = paymentNetwork();
    return net === 'mainnet'
      ? 'mainnet-beta'
      : net === 'testnet'
        ? 'testnet'
        : 'devnet';
  }, []);

  // ---------- ticker symbol maps ----------
  // Built AFTER useChat so we can scan `messages` for arbitrary coin
  // symbols. The default ticker only covers TOP_20; anything outside
  // (DASH, LINK, AVAX, …) gets lazy-fetched here in one batched
  // request so the inline ticker chip on each assistant turn works
  // for any coin the user mentions.
  const baseSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const e of ticker.data) {
      if (e.symbol) set.add(e.symbol.toUpperCase());
    }
    return set;
  }, [ticker.data]);

  const extraSymbols = useExtraSymbolsFromMessages(messages, baseSymbols);
  const extraTickers = useExtraTickers(extraSymbols);

  const tickerByCoin = useMemo<ReadonlyMap<string, number>>(() => {
    const m = new Map<string, number>();
    for (const e of [...ticker.data, ...extraTickers]) {
      if (!e.symbol || !Number.isFinite(e.price)) continue;
      m.set(e.symbol.toUpperCase(), e.price);
    }
    return m;
  }, [ticker.data, extraTickers]);

  const tickerEntryBySymbol = useMemo(() => {
    const m = new Map<string, { price: number; changePct: number }>();
    for (const e of [...ticker.data, ...extraTickers]) {
      if (!e.symbol || !Number.isFinite(e.price)) continue;
      m.set(e.symbol.toUpperCase(), { price: e.price, changePct: e.changePct });
    }
    return m;
  }, [ticker.data, extraTickers]);

  // Recognized tickers + name aliases used by the composer's auto-pill
  // detector below. Includes TOP_20 symbols + friendly names + the
  // TICKER_NAME_MAP aliases + every live engine-known symbol from the
  // current ticker set. Built once per ticker-data change so the
  // detector hot path stays O(1).
  const knownTickerSet = useMemo(() => {
    const symbols = new Set<string>();
    const aliasToSymbol = new Map<string, string>();
    for (const [name, sym] of Object.entries(TICKER_NAME_MAP)) {
      aliasToSymbol.set(name.toLowerCase(), sym);
    }
    for (const coin of TOP_20) {
      symbols.add(coin.symbol);
      aliasToSymbol.set(coin.symbol.toLowerCase(), coin.symbol);
      aliasToSymbol.set(coin.name.toLowerCase(), coin.symbol);
    }
    for (const sym of tickerEntryBySymbol.keys()) {
      symbols.add(sym);
    }
    return { symbols, aliasToSymbol };
  }, [tickerEntryBySymbol]);

  // Tickers typed into the textarea stay at their position in the
  // prompt — the Composer overlay renders them as in-place styled
  // pills. When the user types the space that CONFIRMS a ticker, we
  // slip in two extra padding spaces so the caret's on-screen
  // position lands at the pill's visual right edge (the pill visually
  // widens by ~18px of padding to fit its icon; two extra spaces
  // (~16px) closes that gap without polluting the outgoing message —
  // submit collapses runs of whitespace back down to single spaces).
  const onComposerInputChange = useCallback(
    (newValue: string) => {
      const prev = input;
      const isFreshSpace =
        newValue.length === prev.length + 1 &&
        newValue.startsWith(prev) &&
        newValue.endsWith(' ') &&
        !prev.endsWith(' ');
      if (!isFreshSpace) {
        setInput(newValue);
        return;
      }
      // Walk back to find the word that just got confirmed.
      const beforeSpace = newValue.slice(0, -1);
      const wordMatch = /(\S+)$/.exec(beforeSpace);
      const word = wordMatch?.[1] ?? '';
      const stripped = word.startsWith('$') ? word.slice(1) : word;
      if (!/^[A-Za-z0-9]{2,11}$/.test(stripped)) {
        setInput(newValue);
        return;
      }
      const lower = stripped.toLowerCase();
      const upper = stripped.toUpperCase();
      const symbol =
        knownTickerSet.aliasToSymbol.get(lower) ??
        (knownTickerSet.symbols.has(upper) ? upper : null);
      if (!symbol) {
        setInput(newValue);
        return;
      }
      // Confirmed ticker — inject four extra spaces so the textarea's
      // caret metrics catch up to the pill's visual right edge. The
      // pill's padding-left (18px) + padding-right (4px) totals ~22px
      // of extra visual width; each space in the composer font
      // measures ~4-5px, so four extra spaces (~20px) closes the gap
      // without overshooting.
      setInput(`${newValue}    `);
    },
    [input, knownTickerSet],
  );

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

  // Streaming-end scroll lives after the `isStreaming` derivation so
  // we can read the flag. See the prevStreamingRef effect below.
  const prevStreamingRef = useRef(false);

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

  // Streaming-end scroll — when the response finishes, the assistant
  // bubble re-renders to mount the action row (Copy + 👍 + 👎) BELOW
  // the bubble. The `messages`-only scroll above runs in the same
  // commit but doesn't always catch the newly-mounted action row in
  // `scrollHeight`. Watch the streaming flag transition true→false
  // and schedule a smooth scroll after the next paint so the user
  // lands with the actions in view — no manual scroll needed to copy
  // or react.
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      requestAnimationFrame(() => {
        const el = threadRef.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      });
      // v0.5.1 sequenced-reveal — the assistant just finished
      // streaming, so promote any buffered intent to the visible
      // `pendingIntent` slot. This is the moment Vizzor is "done
      // talking" and the sign card becomes the natural next beat.
      if (bufferedIntent) {
        setPendingIntent(bufferedIntent);
        setBufferedIntent(null);
      }
      // v0.5.2 Phase 1 (fallback) — scan the just-finished assistant
      // message for trade-plan prose. Runs ONLY when the engine did
      // NOT emit a structured `event: trade_plan` this turn (identified
      // by absence of any plan whose issued_at is newer than the
      // previous streaming-end tick). Cards synthesized this way have
      // plan_ids prefixed with `plan_prose_` so they dedupe stably
      // across re-renders and get replaced the moment the engine PR
      // ships and starts emitting authoritative plans.
      const lastAsst = [...messages].reverse().find((m) => m.role === 'assistant');
      if (lastAsst) {
        const text = lastAsst.parts
          .filter((p) => p.type === 'text')
          .map((p) => ('text' in p ? p.text : ''))
          .join('');
        const alreadyHasEngineEmit = Array.from(tradePlans.values()).some(
          (pl) => !pl.plan_id.startsWith('plan_prose_'),
        );
        if (!alreadyHasEngineEmit) {
          const synthesized = parseTradePlansFromProse({
            text,
            messageId: lastAsst.id,
            issuedAt: Date.now(),
            fallbackSymbol: tokenPills[0]?.toUpperCase() ?? null,
          });
          if (synthesized.length > 0) {
            setTradePlans((prev) => {
              const next = new Map(prev);
              // Drop any prior prose-synthesized plans for this
              // message (re-run parse in case the message was edited).
              for (const key of next.keys()) {
                if (key.startsWith(`plan_prose_${lastAsst.id}_`)) {
                  next.delete(key);
                }
              }
              for (const plan of synthesized) next.set(plan.plan_id, plan);
              return next;
            });
          }
        }
      }
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, bufferedIntent, messages, tradePlans, tokenPills]);
  const isErrored = status === 'error';

  const submitPrompt = useCallback(
    (text: string): void => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming || composerLocked) return;

      // v0.5.1 — the composer routes by action. A prompt like
      // `predict SOL 4h. send 0.05 SOL to <addr>` mints the transfer
      // intent AND fires /predict with the FULL prompt so the
      // engine's LLM can read the workflow syntax and reference it in
      // its response ("your queued 0.05 SOL transfer to <addr>…
      // executes in one signature"). A bare `send 0.1 SOL to <addr>`
      // with no other prose skips /predict entirely — the user asked
      // for a transaction, not a prediction, so we mint + open the
      // sign modal without spending an engine turn.
      //
      // Parsing walks the prompt in a loop so multiple commands in a
      // single turn (e.g. `send 0.05 SOL to A. pay 0.02 USDC to B`)
      // all mint intents. Only the first shows a card in this MVP;
      // the rest queue as metadata for the engine to narrate when
      // /predict does fire. Multi-card UI is a follow-up.
      const parsedCommands: ParsedCommand[] = [];
      let commandResidue = trimmed;
      {
        let scan = trimmed;
        // Cap the loop so a pathological regex can't run away.
        for (let i = 0; i < 8; i += 1) {
          const p = parseCommand(scan);
          if (!p) break;
          parsedCommands.push(p);
          const next = stripCommand(scan, p);
          if (next === scan) break;
          scan = next;
          if (next.length === 0) break;
        }
        commandResidue = scan;
      }
      // Residue = everything left after stripping every parsed
      // command. If it's empty (or just punctuation), the prompt was
      // pure action → skip /predict. If it has any real prose we fire
      // /predict with the FULL trimmed body so the engine can narrate
      // both the analysis AND the queued action.
      const RESIDUE_PROSE_RE = /[A-Za-z0-9$]/;
      const hasResiduePrompt =
        RESIDUE_PROSE_RE.test(commandResidue) && commandResidue.length >= 2;

      if (parsedCommands.length > 0) {
        if (commandInFlight) return; // debounce double-submit
        setCommandInFlight(parsedCommands[0]!.capability);
        setCommandError(null);
        void (async () => {
          try {
            // Ensure a conversation exists BEFORE minting so we can
            // link the intents to it (workflows page groups by
            // conversation_id).
            let convId = activeConversationId;
            if (signedIn && !convId) {
              const conv = await createConversation(trimmed);
              if (conv) {
                convId = conv.id;
                setActiveConversationId(conv.id);
              }
            }

            // v0.5.2 — coordinate-payment mints default to firing 24h
            // out. The user can edit the schedule inside the intent
            // card before signing; changing the datetime triggers a
            // re-mint since the canonical bytes bake execute_at in.
            // Transfers ignore this field entirely (server refuses it
            // for kind='transfer', which would otherwise poison the
            // canonical).
            const DEFAULT_PAYMENT_LEAD_MS = 24 * 60 * 60_000;
            const now = Date.now();

            // Mint every parsed intent in parallel.
            const mintResponses = await Promise.all(
              parsedCommands.map((p) =>
                fetch('/api/capabilities/create-intent', {
                  method: 'POST',
                  credentials: 'same-origin',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    capability: p.capability,
                    network: 'sol',
                    to_addr: p.toAddr,
                    symbol: p.symbol,
                    amount: p.amount,
                    conversation_id: convId ?? null,
                    ...(p.capability === 'payment'
                      ? {
                          execute_at: now + DEFAULT_PAYMENT_LEAD_MS,
                          recurrence: 'once',
                        }
                      : {}),
                  }),
                }).then(async (res) => ({
                  res,
                  data: (await res.json()) as
                    | { ok: true; intent: PendingIntent }
                    | { ok: false; reason?: string; detail?: string },
                })),
              ),
            );

            const firstFailure = mintResponses.find(
              (r) => !r.res.ok || r.data.ok === false,
            );
            if (firstFailure) {
              const reason =
                firstFailure.data.ok === false
                  ? (firstFailure.data.reason ?? 'errorGeneric')
                  : 'errorGeneric';
              const detail =
                firstFailure.data.ok === false
                  ? firstFailure.data.detail
                  : undefined;
              setCommandError(detail ? `${reason}::${detail}` : reason);
              return;
            }

            const intents: PendingIntent[] = mintResponses
              .map((r) => (r.data.ok === true ? r.data.intent : null))
              .filter((i): i is PendingIntent => i !== null);

            // Arm every capability that got minted so the tray icons
            // stay accented until the intents settle.
            setArmedCapabilities((prev) => {
              const next = new Set(prev);
              for (const p of parsedCommands) next.add(p.capability);
              return next;
            });
            // v0.5.1 — sequenced-reveal. If the composer ALSO fires
            // /predict this turn (workflow prompt like `predict SOL
            // 4h. send 0.1 SOL to X`), the intent goes into the
            // buffer and only surfaces once the assistant response
            // finishes streaming. If /predict isn't fired (bare
            // `send 0.1 SOL to X` with no other prose), the intent
            // surfaces immediately.
            if (intents[0] && hasResiduePrompt) {
              setBufferedIntent(intents[0]);
            } else {
              setPendingIntent(intents[0] ?? null);
            }

            if (hasResiduePrompt) {
              // Fire /predict with the FULL prompt (commands
              // included) so the engine's LLM can read the workflow
              // syntax and reference it in its response.
              // queued_intents metadata is attached so the engine can
              // inject "the user has queued N workflows" into its
              // system prompt.
              const queuedIntentsBody = intents.map((i) => ({
                intent_id: i.intent_id,
                kind: i.kind,
                symbol: i.symbol,
                amount: i.amount,
                to_addr: i.to_addr,
              }));
              const armed = Array.from(
                new Set([
                  ...armedCapabilities,
                  ...parsedCommands.map((p) => p.capability),
                ]),
              ).filter((c) => ALL_CAP_IDS.includes(c));

              // Best-effort wallet-balance grounding for the LLM.
              const walletContext = await fetchWalletContext();

              sendMessage(
                { text: trimmed },
                {
                  body: {
                    capabilities: armed,
                    queued_intents: queuedIntentsBody,
                    ...(walletContext ? { wallet_context: walletContext } : {}),
                  },
                },
              );
            } else {
              // Pure-action path: no engine call. Push a synthetic
              // user turn so the composer clears + the conversation
              // shows the request that triggered the intent, without
              // opening a stream we'd only close.
              setMessages((prev) => [
                ...prev,
                {
                  id:
                    globalThis.crypto?.randomUUID?.() ??
                    `usr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
                  role: 'user' as const,
                  parts: [{ type: 'text' as const, text: trimmed }],
                },
              ]);
            }

            setInput('');
            setTokenPills([]);
            setDrawerOpen(false);
          } catch (e) {
            setCommandError('errorNetwork');
            // eslint-disable-next-line no-console
            console.warn('[capability.command] co-fire failed', e);
          } finally {
            setCommandInFlight(null);
          }
        })();
        return;
      }

      // Regular prediction path — no capability command present.
      if (signedIn && !activeConversationId) {
        void (async () => {
          const conv = await createConversation(trimmed);
          if (conv) setActiveConversationId(conv.id);
        })();
      }
      // Armed capabilities ride in the per-request body so the
      // server can intersect them with the wallet's enabled set
      // before forwarding to the engine. Empty array is the default
      // shape — /api/predict treats it as "predict-only, no on-chain
      // side effects", the pre-v0.5.0 behavior.
      const armed = [...armedCapabilities].filter((c) =>
        ALL_CAP_IDS.includes(c),
      );
      // v0.5.1 — fire wallet-balance fetch alongside the send so the
      // engine has grounding context whether or not the user drafted
      // a workflow command. Best-effort — never blocks the submit.
      const balanceReady = fetchWalletContext();
      void balanceReady.then((walletContext) => {
        const extra: Record<string, unknown> = {};
        if (armed.length > 0) extra.capabilities = armed;
        if (walletContext) extra.wallet_context = walletContext;
        sendMessage(
          { text: trimmed },
          Object.keys(extra).length > 0 ? { body: extra } : undefined,
        );
      });
      setInput('');
      setTokenPills([]);
      setArmedCapabilities(new Set());
      setDrawerOpen(false);
    },
    [
      isStreaming,
      composerLocked,
      sendMessage,
      setMessages,
      signedIn,
      activeConversationId,
      setActiveConversationId,
      createConversation,
      armedCapabilities,
      commandInFlight,
    ],
  );

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    // Pills ride ahead of the typed text — sent as space-separated
    // tickers so the engine picks them up the same way it does when a
    // user types "BTC ETH 4h" directly. The typed content is
    // normalized: runs of whitespace collapse back to a single space
    // (the caret-alignment injector inside the composer may have
    // added a couple of padding spaces after confirmed tickers).
    const prefix = tokenPills.length > 0 ? `${tokenPills.join(' ')} ` : '';
    const normalized = input.replace(/[ \t]{2,}/g, ' ');
    submitPrompt(`${prefix}${normalized}`.trim());
  };

  const onNewChat = (): void => {
    setMessages([]);
    setInput('');
    setTokenPills([]);
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
      // v0.5.2 — trade plans are ephemeral per session (they arrive
      // via SSE data-parts on the live stream, not persisted with
      // the conversation history). Reset when switching so a plan
      // from a previous chat doesn't linger on the newly-loaded one.
      setTradePlans(new Map());
      setDrawerOpen(false);
    },
    [loadConversation, setMessages],
  );

  // v0.5.1 — chat-delete guard state. When `deleteConversation` throws
  // `WorkflowsBlockingDeleteError` the confirm dialog opens with the
  // exact count + kinds so the user knows what's at stake. Approving
  // re-runs the delete with `{ force: true }`.
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    count: number;
    kinds: string[];
  } | null>(null);

  const finalizeDelete = useCallback(
    (id: string) => {
      if (id === activeConversationId) {
        setMessages([]);
        setActiveConversationId(null);
        persistedRef.current = new Set();
      }
    },
    [activeConversationId, setMessages],
  );

  const onDeleteConversation = useCallback(
    async (id: string): Promise<void> => {
      try {
        const ok = await deleteConversation(id);
        if (!ok) return;
        finalizeDelete(id);
      } catch (e) {
        if (e instanceof WorkflowsBlockingDeleteError) {
          setPendingDelete({ id, count: e.count, kinds: e.kinds });
          return;
        }
        throw e;
      }
    },
    [deleteConversation, finalizeDelete],
  );

  const confirmForceDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setPendingDelete(null);
    try {
      const ok = await deleteConversation(id, { force: true });
      if (!ok) return;
      finalizeDelete(id);
    } catch {
      /* if the force delete still fails, do nothing — the dialog is
       * already closed and re-opening it wouldn't tell the user
       * anything actionable */
    }
  }, [deleteConversation, finalizeDelete, pendingDelete]);
  const cancelForceDelete = useCallback(() => setPendingDelete(null), []);

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

  const onOpenWorkflows = useCallback(() => {
    // typedRoutes doesn't yet know about hashes — cast through never.
    // v0.5.3 — surface renamed from workflows → transactions. The
    // callback name stays workflows-based for now so we don't churn
    // every consumer, but the navigation target is the new route.
    router.push('/app/transactions' as never);
    setDrawerOpen(false);
  }, [router]);

  const onOpenDirectory = useCallback(() => {
    // Directory lives outside the predict surface; this is real
    // navigation, not a sheet. We close the mobile drawer in case the
    // tap originated from inside it.
    router.push('/app/directory' as never);
    setDrawerOpen(false);
  }, [router]);

  const onOpenAlerts = useCallback(() => {
    // Open the in-shell modal instead of navigating away. The modal
    // mounts the same AlertsList component as /app/alerts so the
    // armed/triggered/resolved UI is identical — just framed by a
    // sheet so users stay in the chat surface.
    setAlertsOpen(true);
    setDrawerOpen(false);
    // v0.5.2 — opening the drawer is the user's "I've seen these"
    // signal. Clear the alerts bucket in the notifications ledger so
    // the badge drops to 0 without waiting for the 30s poll.
    if (signedIn && notifCounts.alerts > 0) {
      void markAllNotifRead('alerts');
    }
  }, [signedIn, notifCounts.alerts, markAllNotifRead]);

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
   * v0.5.2 — auto-narrate an intent's terminal status.
   *
   * When the IntentChatCard flips to executed / failed / rejected /
   * expired, this callback appends a synthetic Vizzor assistant turn
   * summarizing the outcome (with the tx hash + explorer link when
   * applicable). Two reasons this lives here, not in the card:
   *   1. `setMessages` is a useChat handle owned by this shell.
   *   2. The receipt needs to survive after the transient card
   *      unmounts, so it belongs in the conversation log, not the
   *      card's own state.
   *
   * Fire-and-forget POSTs the same event to `/api/notifications/emit`
   * so the sidebar badge on Workflows updates without a page
   * refresh. Failures are silent — a missed notification never
   * blocks the chat log.
   */
  const tNotify = useTranslations('predict.capability.notify');
  const onIntentFinalStatus = useCallback(
    (event: {
      intent_id: string;
      kind: CapId;
      symbol: string;
      amount: string;
      status: 'executed' | 'failed' | 'rejected' | 'expired' | 'scheduled';
      tx_hash?: string;
      explorer_url?: string;
      error?: string;
      execute_at?: number;
    }) => {
      // 1. Emit an assistant message narrating the outcome.
      const shortId = event.intent_id.length > 12
        ? `${event.intent_id.slice(0, 6)}…${event.intent_id.slice(-4)}`
        : event.intent_id;
      const shortTx = event.tx_hash
        ? event.tx_hash.length > 12
          ? `${event.tx_hash.slice(0, 6)}…${event.tx_hash.slice(-4)}`
          : event.tx_hash
        : null;

      let text: string;
      if (event.status === 'executed') {
        text = shortTx
          ? tNotify('executedWithTx', {
              amount: event.amount,
              symbol: event.symbol,
              tx: shortTx,
            })
          : tNotify('executed', {
              amount: event.amount,
              symbol: event.symbol,
            });
      } else if (event.status === 'scheduled') {
        const when = event.execute_at
          ? new Date(event.execute_at).toLocaleString(undefined, {
              hour12: false,
            })
          : '';
        text = tNotify.has('scheduled' as never)
          ? (
              tNotify as unknown as (
                k: string,
                v: Record<string, string>,
              ) => string
            )('scheduled', {
              amount: event.amount,
              symbol: event.symbol,
              when,
            })
          : `Your payment of ${event.amount} ${event.symbol} is scheduled for ${when}.`;
      } else if (event.status === 'failed') {
        text = tNotify('failed', {
          amount: event.amount,
          symbol: event.symbol,
          reason: event.error ?? '',
        });
      } else if (event.status === 'rejected') {
        text = tNotify('rejected', {
          amount: event.amount,
          symbol: event.symbol,
        });
      } else {
        text = tNotify('expired', {
          amount: event.amount,
          symbol: event.symbol,
        });
      }

      setMessages((prev) => [
        ...prev,
        {
          id:
            globalThis.crypto?.randomUUID?.() ??
            `sys_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          role: 'assistant' as const,
          parts: [{ type: 'text' as const, text }],
        },
      ]);

      // 2. Fire-and-forget notification emit. Skipped for the
      //    'scheduled' status — that's not something the sidebar
      //    badge should surface (the user just performed the
      //    schedule action intentionally). The real notification
      //    fires later via the server-side scheduler-tick when
      //    execute_at arrives (kind = 'payment_due').
      if (event.status !== 'scheduled') {
        const level =
          event.status === 'executed'
            ? 'success'
            : event.status === 'expired'
              ? 'warn'
              : 'error';
        void fetch('/api/notifications/emit', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind:
              event.status === 'executed'
                ? 'workflow_executed'
                : 'workflow_failed',
            ref_id: event.intent_id,
            level,
            symbol: event.symbol,
            amount: event.amount,
            tx_hash: event.tx_hash ?? null,
            explorer_url: event.explorer_url ?? null,
            error: event.error ?? null,
            short_id: shortId,
          }),
        }).catch(() => {
          /* silent — notifications are best-effort */
        });
      }
    },
    [setMessages, tNotify],
  );

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
   * Per-assistant-message thumbs-up / thumbs-down state. Optimistic:
   * the UI flips immediately, then POSTs to /api/predict/feedback.
   * On failure we roll back so the button truthfully reflects what the
   * server has on file. Cleared when the conversation switches.
   */
  const [feedbackByMessageId, setFeedbackByMessageId] = useState<
    ReadonlyMap<string, 'up' | 'down'>
  >(() => new Map());
  useEffect(() => {
    // Switching conversations wipes the optimistic feedback map — the
    // server is the source of truth and we'll re-hydrate on demand if a
    // feedback-history endpoint ships in a later pass.
    setFeedbackByMessageId(new Map());
  }, [activeConversationId]);

  const onFeedbackMessage = useCallback(
    async (
      messageId: string,
      value: 'up' | 'down' | null,
    ): Promise<void> => {
      if (!activeConversationId) return;
      const prevMap = feedbackByMessageId;
      setFeedbackByMessageId((map) => {
        const next = new Map(map);
        if (value === null) next.delete(messageId);
        else next.set(messageId, value);
        return next;
      });
      try {
        const res = await fetch('/api/predict/feedback', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            conversation_id: activeConversationId,
            message_id: messageId,
            value,
          }),
        });
        if (!res.ok) throw new Error(`feedback_${res.status}`);
      } catch (err) {
        setFeedbackByMessageId(prevMap);
        throw err;
      }
    },
    [activeConversationId, feedbackByMessageId],
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
          onOpenWorkflows={onOpenWorkflows}
          onOpenDirectory={onOpenDirectory}
          onOpenSettings={onOpenSettings}
          signedIn={signedIn}
          wallet={auth?.wallet}
          quota={quota}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          alertsBadge={notifCounts.alerts}
          workflowsBadge={notifCounts.workflows}
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
              data-tour-id="mobile-menu-trigger"
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
                {messages.map((m, idx) => {
                  // For assistant turns, derive inline ticker chips
                  // from the user prompt that immediately precedes
                  // this assistant turn (one-shot lookback). The chips
                  // render in the "VIZZOR · HH:MM:SS" header so the
                  // live price reads as context tied to the response
                  // rather than the response itself. Recognized
                  // tickers only — same allow-list as before to avoid
                  // false positives like "TO" or "AND".
                  const isAssistantTurn = m.role === 'assistant';
                  const isUserTurn = m.role === 'user';
                  let inlineTickers: InlineTickerChipEntry[] = [];
                  // Source text for ticker detection:
                  //   - user turns: the turn's own text (the prompt the
                  //     user just sent — chips render inline inside the
                  //     bubble at the top, replacing leading "BTC ETH"
                  //     plain-text tokens with visual chips).
                  //   - assistant turns: the PRECEDING user message
                  //     (chips ride alongside the VIZZOR · HH:MM:SS
                  //     header as context for the response).
                  let sourceText = '';
                  if (isUserTurn) {
                    sourceText = m.parts
                      .filter((p) => p.type === 'text')
                      .map((p) => ('text' in p ? p.text : ''))
                      .join(' ');
                  } else if (isAssistantTurn) {
                    for (let i = idx - 1; i >= 0; i--) {
                      const prev = messages[i];
                      if (!prev || prev.role !== 'user') continue;
                      sourceText = prev.parts
                        .filter((p) => p.type === 'text')
                        .map((p) => ('text' in p ? p.text : ''))
                        .join(' ');
                      break;
                    }
                  }
                  if (sourceText) {
                    const detected = extractTickersFromText(sourceText);
                    // Render a chip for every detected symbol; if the
                    // lazy lookup hasn't returned price yet (or the
                    // engine doesn't know the coin), the chip renders
                    // symbol-only. The CoinIcon shows the symbol's
                    // monogram when the logo CDN 404s, so unknown
                    // coins still get a recognizable circle + label.
                    inlineTickers = detected.map((sym) => {
                      const entry = tickerEntryBySymbol.get(sym);
                      return {
                        symbol: sym,
                        price: entry?.price,
                        changePct: entry?.changePct,
                      };
                    });
                  }
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
                        onFeedback={isAssistantTurn ? onFeedbackMessage : undefined}
                        currentFeedback={
                          isAssistantTurn
                            ? feedbackByMessageId.get(m.id) ?? null
                            : null
                        }
                        inlineTickers={inlineTickers}
                        editLabel={t('shell.composer.edit')}
                        sourcesLabel={t('shell.composer.sources')}
                        copyLabel={t('shell.composer.copy')}
                        copiedLabel={t('shell.composer.copied')}
                        feedbackUpLabel={t('shell.composer.feedbackUp')}
                        feedbackDownLabel={t('shell.composer.feedbackDown')}
                        feedbackSentLabel={t('shell.composer.feedbackSent')}
                        compactLabel={t('shell.composer.compact')}
                        compactedLabel={t('shell.composer.compacted')}
                        tickerByCoin={tickerByCoin}
                        priceCheck={{
                          label: t('shell.composer.priceCheckLabel'),
                          body: t('shell.composer.priceCheckBody'),
                        }}
                      />
                    </div>
                  );
                })}
                {/* v0.5.0 — pending capability intent as an in-thread
                    Vizzor response. Lives at the tail of the message
                    stream instead of a floating modal so the flow reads
                    conversationally: user typed the send command → Vizzor
                    replied with the intent to review + Sign/Reject
                    actions. Reject dismisses; Sign fires the wallet
                    prompt and settles via /api/execute-intent. */}
                {/* v0.5.2 Phase 1 — engine-emitted trade plans render
                    ABOVE the intent card. Reading order matches the
                    workflow: (1) Vizzor writes a trade plan, (2) user
                    arms alerts on each level, (3) if the plan has a
                    proceeds_to address, the user hits Sign & send
                    which mints an intent — the sign card mounts
                    below. */}
                {tradePlansArr.map((plan) => (
                  <TradePlanCard
                    key={plan.plan_id}
                    plan={plan}
                    network={tradePlanNetwork}
                    onProceedsSend={onProceedsSend}
                  />
                ))}
                {pendingIntent && (
                  <IntentChatCard
                    intent={pendingIntent}
                    onDismiss={() => {
                      if (pendingIntent) {
                        setArmedCapabilities((prev) => {
                          const next = new Set(prev);
                          next.delete(pendingIntent.kind);
                          return next;
                        });
                      }
                      setPendingIntent(null);
                    }}
                    onExecuted={(result) => {
                      setArmedCapabilities((prev) => {
                        const next = new Set(prev);
                        if (
                          pendingIntent &&
                          pendingIntent.intent_id === result.intent_id
                        ) {
                          next.delete(pendingIntent.kind);
                        }
                        return next;
                      });
                      void capabilities.refresh();
                    }}
                    onFinalStatus={onIntentFinalStatus}
                  />
                )}
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
              onInsert={(seed, meta) => {
                // Token chips (anything with a `ticker`) drop a visual
                // pill inside the composer instead of typing into the
                // textarea — same end result on submit (ticker is
                // prefixed to the message) but the user sees a
                // recognizable icon+symbol chip while they compose.
                // Non-token insert chips keep the prior behavior of
                // seeding the textarea with text.
                if (meta?.ticker) {
                  const sym = meta.ticker.toUpperCase();
                  setTokenPills((prev) =>
                    prev.includes(sym) ? prev : [...prev, sym],
                  );
                  setTimeout(() => inputRef.current?.focus(), 0);
                  return;
                }
                setInput((v) => {
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
                <>
                  <Composer
                    inputRef={inputRef}
                    value={input}
                    onChange={onComposerInputChange}
                    knownTickerSet={knownTickerSet}
                    onSubmit={onSubmit}
                    onStop={stop}
                    isStreaming={isStreaming}
                    placeholder={t('shell.composer.placeholder')}
                    sendLabel={t('send')}
                    stopLabel={t('shell.composer.stop')}
                    hintLabel={t('shell.composer.kbdHint')}
                    signedIn={signedIn}
                    tokenPills={tokenPills}
                    onRemovePill={(sym) => onRemoveTokenPill(sym)}
                    armedCapabilities={armedCapabilities}
                    enabledCapabilities={capabilities.enabledSet}
                    tierLocked={tierLocked}
                    currentCapabilityAction={openActionCap}
                    onOpenCapabilityAction={openCapabilityAction}
                  />
                  {/* Inline capability feedback — surfaces the
                      /transfer command status right below the
                      composer instead of a toast. Mounts only when
                      there's something to say so the row doesn't
                      steal focus. */}
                  <CommandStatus
                    inFlight={commandInFlight}
                    error={commandError}
                    onDismiss={() => setCommandError(null)}
                  />
                </>
              )}
            </div>
          </div>
        </section>

      </div>

      {/* v0.5.0 — agent-payment ENABLE modal. Opens only when the
          clicked capability isn't yet enabled (or the wallet is on
          the free tier). Draft happens inline in the composer via
          the /transfer command syntax, so we never render a form
          here anymore. On successful enable we jump straight to
          inserting the command template into the textbox. */}
      <CapabilityActionModal
        capability={openActionCap}
        tierLocked={tierLocked}
        onDismiss={() => setOpenActionCap(null)}
        onEnabled={onCapabilityEnabled}
      />

      {/* v0.5.1 — chat-delete guard. Only mounts when the user tried
          to delete a conversation that still carries active
          (pending/signed) capability intents. Approving fires a
          second DELETE with ?force=1. */}
      <DeleteWorkflowsGuard
        pending={pendingDelete}
        onConfirm={() => void confirmForceDelete()}
        onCancel={cancelForceDelete}
      />

      {/* v0.5.0 — the in-thread IntentChatCard renders inside the
          message stream (see the `pendingIntent` slot after the
          messages loop above), not here as a floating modal. This
          slot is intentionally empty to make that move explicit. */}

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
          onOpenWorkflows={onOpenWorkflows}
          onOpenDirectory={onOpenDirectory}
          onOpenSettings={onOpenSettings}
          signedIn={signedIn}
          wallet={auth?.wallet}
          quota={quota}
          alertsBadge={notifCounts.alerts}
          workflowsBadge={notifCounts.workflows}
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


/**
 * v0.5.1 — fetch the connected wallet's balance snapshot for the
 * engine's LLM grounding. Best-effort: any failure (401, timeout,
 * RPC blip) resolves to null and the caller forwards a plain
 * predict request without balance context. Never throws.
 */
async function fetchWalletContext(): Promise<unknown | null> {
  try {
    const controller = new AbortController();
    // 3s hard cap — the LLM grounding is nice-to-have and blocking
    // the send on a slow RPC would degrade the core prediction UX.
    const timer = setTimeout(() => controller.abort(), 3_000);
    const res = await fetch('/api/wallet/balance', {
      credentials: 'same-origin',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok: boolean;
      wallet?: string;
      network?: string;
      as_of?: number;
      sol?: number | null;
      spl?: unknown;
    };
    if (!data.ok || !data.wallet || !data.network || !data.as_of) return null;
    return {
      wallet: data.wallet,
      network: data.network,
      as_of: data.as_of,
      sol: typeof data.sol === 'number' ? data.sol : null,
      spl: Array.isArray(data.spl) ? data.spl : [],
    };
  } catch {
    return null;
  }
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
  onOpenWorkflows: () => void;
  onOpenDirectory: () => void;
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
  /** v0.5.2 — unread notification counts sourced from the shell's
   *  useNotifications() hook. Passed as plain numbers so the rail
   *  doesn't have to import the hook itself. */
  alertsBadge?: number;
  workflowsBadge?: number;
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
  onOpenWorkflows,
  onOpenDirectory,
  onOpenSettings,
  signedIn,
  wallet,
  quota,
  collapsed = false,
  onToggleCollapse,
  embedded = false,
  alertsBadge,
  workflowsBadge,
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
            badgeCount={alertsBadge}
            tourId="nav-alerts"
          />
          {/* Directory — Skills / Connectors / Plugins. Mounted here so
              the entry stays reachable from inside the predict surface
              (which suppresses both AppSidebar and ProductSidebar in
              favor of this rail). Stroke + size match the predict-icons
              treatment so Boxes (lucide) sits visually with IconBell. */}
          <NavButton
            icon={<Boxes size={collapsed ? 20 : 17} strokeWidth={1.6} />}
            label={t('shell.nav.directory')}
            onClick={onOpenDirectory}
            collapsed={collapsed}
          />
          <NavButton
            icon={
              <ArrowLeftRight
                size={collapsed ? 20 : 17}
                strokeWidth={1.7}
              />
            }
            label={t('shell.nav.transactions')}
            onClick={onOpenWorkflows}
            collapsed={collapsed}
            badgeCount={workflowsBadge}
            tourId="nav-transactions"
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
        data-tour-id="identity-row"
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
  badgeCount,
  tourId,
}: {
  icon: ReactNode;
  label: string;
  meta?: string;
  active?: boolean;
  onClick?: () => void;
  collapsed?: boolean;
  /**
   * v0.5.2 — mirrors the ProductSidebar NavButton badge shape. Powers
   * the unread pill next to Alerts / Workflows entries in the predict
   * shell's LeftRail. Renders as a compact numeric pill in the
   * expanded rail and a small accent dot in the collapsed gutter.
   */
  badgeCount?: number;
  /**
   * v0.5.4 — stable id for the first-time-login guided tour to
   * spotlight this specific rail entry. See
   * `components/onboarding/tour-steps.ts` for the catalogue.
   */
  tourId?: string;
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
  const hasBadge = typeof badgeCount === 'number' && badgeCount > 0;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-tour-id={tourId}
        aria-label={hasBadge ? `${label} (${badgeCount})` : label}
        aria-current={active ? 'page' : undefined}
        title={label}
        className={cn(
          'group relative inline-flex items-center justify-center',
          'h-11 w-11 rounded-lg transition-colors',
          tonal,
        )}
      >
        <span className={cn('transition-colors', iconTone)}>{icon}</span>
        {hasBadge && (
          <span
            aria-hidden
            className={cn(
              'absolute top-1.5 right-1.5',
              'h-2 w-2 rounded-full bg-[var(--accent)]',
            )}
          />
        )}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      data-tour-id={tourId}
      aria-current={active ? 'page' : undefined}
      aria-label={hasBadge ? `${label} (${badgeCount})` : undefined}
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
      {hasBadge ? (
        <span
          aria-hidden
          className={cn(
            'shrink-0 mono tabular text-[9.5px] font-semibold',
            'inline-flex items-center justify-center',
            'h-[16px] min-w-[16px] px-1 rounded-full',
            'bg-[var(--accent)] text-[var(--bg)]',
          )}
        >
          {badgeCount! > 99 ? '99+' : badgeCount}
        </span>
      ) : meta ? (
        <span
          className={cn(
            'mono tabular text-[10px] uppercase tracking-[0.14em] transition-colors',
            active ? 'text-[var(--fg-2)]' : 'text-[var(--fg-3)] group-hover:text-[var(--fg-2)]',
          )}
        >
          {meta}
        </span>
      ) : null}
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
  onOpenWorkflows,
  onOpenDirectory,
  onOpenSettings,
  signedIn,
  wallet,
  quota,
  alertsBadge,
  workflowsBadge,
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
  onOpenWorkflows: () => void;
  onOpenDirectory: () => void;
  onOpenSettings: () => void;
  signedIn: boolean;
  wallet: string | undefined;
  quota?: QuotaState;
  alertsBadge?: number;
  workflowsBadge?: number;
}) {
  const t = useTranslations('predict');

  /**
   * v0.5.22 — closing-phase flag. Any in-drawer close gesture (X,
   * backdrop tap, Esc, tour-finished event) flips `closing=true`,
   * which swaps the enter keyframe for exit and fades the backdrop.
   * After 180ms we call the parent's `onClose` to unmount.
   */
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, 180);
  }, [closing, onClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  // v0.5.22 — SpotlightTour dispatches `vizzor-tour-finished` on
  // finish or skip. Listen here (rather than in the parent) so the
  // close plays the slide-out keyframe instead of the parent
  // snapping the mount off.
  useEffect(() => {
    const onFinished = () => requestClose();
    window.addEventListener('vizzor-tour-finished', onFinished);
    return () => window.removeEventListener('vizzor-tour-finished', onFinished);
  }, [requestClose]);

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
        onClick={requestClose}
        className={cn(
          'absolute inset-0 bg-black/55 backdrop-blur-sm',
          closing
            ? 'motion-safe:animate-[vt-drawer-fade-out_180ms_ease-in_forwards]'
            : 'motion-safe:animate-[vt-drawer-fade-in_180ms_ease-out]',
        )}
      />
      <div
        className={cn(
          'relative flex flex-col w-[min(320px,86vw)] h-full',
          // Match the desktop LeftRail: black `--bg` page background
          // instead of the lifted `--surface` card. Standardized so
          // both this drawer AND MobileAppNav read as an extension
          // of the desktop rail color, not a floating lighter panel.
          'bg-[var(--bg)]',
          closing
            ? 'motion-safe:animate-[vt-drawer-out_180ms_ease-in_forwards]'
            : 'motion-safe:animate-[vt-drawer-in_200ms_ease-out]',
        )}
      >
        <style>{`
          @keyframes vt-drawer-in {
            from { transform: translate3d(-100%, 0, 0); }
            to   { transform: translate3d(0, 0, 0); }
          }
          @keyframes vt-drawer-out {
            from { transform: translate3d(0, 0, 0); }
            to   { transform: translate3d(-100%, 0, 0); }
          }
          @keyframes vt-drawer-fade-in {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
          @keyframes vt-drawer-fade-out {
            from { opacity: 1; }
            to   { opacity: 0; }
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
            onClick={requestClose}
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
            onOpenWorkflows={onOpenWorkflows}
            onOpenDirectory={onOpenDirectory}
            onOpenSettings={onOpenSettings}
            signedIn={signedIn}
            wallet={wallet}
            quota={quota}
            embedded
            alertsBadge={alertsBadge}
            workflowsBadge={workflowsBadge}
            className="flex h-full border-0 bg-transparent shadow-none backdrop-blur-none"
          />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── ComposerPill ─────────────────────────── */

/**
 * ComposerPill — token chip rendered inline inside the composer when
 * the user picks a coin from the carousel. CoinIcon at 70% opacity
 * keeps the chip clearly subordinate to the typed text that follows;
 * the "×" removes the pill. Once the user has 3+ pills the chip
 * collapses to icon-only — the symbol shifts to a hover tooltip and
 * the entire chip becomes the click target for removal. Keeps the
 * textarea space honest while staying recognizable.
 */
function ComposerPill({
  symbol,
  compact = false,
  onRemove,
}: {
  symbol: string;
  compact?: boolean;
  onRemove: () => void;
}) {
  if (compact) {
    // Icon-only mode — the entire chip is the remove button. Hover
    // dims the icon and reveals a faint ring so the user reads "click
    // to remove" without an explicit "×" eating pixels.
    return (
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${symbol}`}
        title={symbol}
        className={cn(
          'group inline-flex items-center justify-center',
          'h-6 w-6 rounded-full',
          'border border-[var(--border)]',
          'bg-[color-mix(in_oklab,var(--surface-2)_60%,transparent)]',
          'hover:border-[var(--border-hi)] hover:bg-[var(--surface-2)]',
          'transition-colors',
        )}
      >
        <span className="opacity-70 group-hover:opacity-100 inline-flex items-center transition-opacity">
          <CoinIcon symbol={symbol} size={12} />
        </span>
      </button>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5',
        'h-6 pl-1.5 pr-1 rounded-full',
        'border border-[var(--border)]',
        'bg-[color-mix(in_oklab,var(--surface-2)_60%,transparent)]',
        'text-[var(--fg)]',
      )}
    >
      <span className="opacity-70 inline-flex items-center">
        <CoinIcon symbol={symbol} size={12} />
      </span>
      <span className="mono tabular text-[11px] font-semibold leading-none">
        {symbol}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${symbol}`}
        title={`Remove ${symbol}`}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface)] transition-colors"
      >
        <svg
          width={8}
          height={8}
          viewBox="0 0 8 8"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M1.5 1.5 L6.5 6.5 M6.5 1.5 L1.5 6.5" />
        </svg>
      </button>
    </span>
  );
}

/* ─────────────────────── CommandStatus (inline) ─────────────────────── */

/**
 * Small strip below the composer that shows the capability command
 * lifecycle: "settling…" while /api/capabilities/create-intent is
 * inflight, and a translated error label when the server refuses
 * the draft (bad recipient, capability not enabled, etc.). Idle
 * state renders nothing so the composer chrome stays clean.
 */
function CommandStatus({
  inFlight,
  error,
  onDismiss,
}: {
  inFlight: CapId | null;
  error: string | null;
  onDismiss: () => void;
}) {
  const t = useTranslations('predict.capability.intent');
  if (!inFlight && !error) return null;
  if (inFlight) {
    return (
      <div
        role="status"
        className="mt-2 mx-auto max-w-[860px] px-3 sm:px-6 text-[11.5px] text-[var(--fg-3)] mono"
      >
        {t('creating')} · /{inFlight}
      </div>
    );
  }
  const [rawReason, detail] = (error ?? '').split('::');
  const reason = rawReason ?? error ?? '';
  const label = t.has(`reasons.${reason}` as never)
    ? t(`reasons.${reason}` as never)
    : reason || t('errorGeneric');
  return (
    <div
      role="alert"
      className="mt-2 mx-auto max-w-[860px] px-3 sm:px-6"
    >
      <div className="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--down)_10%,transparent)] px-3 py-2 text-[11.5px] text-[var(--down)] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div>{label}</div>
          {detail && (
            <div className="mt-1 mono text-[10.5px] opacity-70 break-all">
              {detail}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 text-[var(--fg-3)] hover:text-[var(--fg)] px-1"
        >
          ×
        </button>
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
  signedIn,
  tokenPills,
  onRemovePill,
  knownTickerSet,
  armedCapabilities,
  enabledCapabilities,
  tierLocked,
  currentCapabilityAction,
  onOpenCapabilityAction,
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
  /** Gates the Directory picker — the menu only opens when SIWS-bound. */
  signedIn: boolean;
  /** Tickers the user picked from the carousel — render inline as
   *  icon + symbol pills before the textarea. Cleared on submit. */
  tokenPills: ReadonlyArray<string>;
  onRemovePill: (symbol: string) => void;
  /** Recognized tickers + name aliases. Used by the in-place pill
   *  overlay to detect ticker words anywhere in the prompt. */
  knownTickerSet: {
    symbols: ReadonlySet<string>;
    aliasToSymbol: ReadonlyMap<string, string>;
  };
  /** v0.5.0 agent-payment capabilities. See CapabilityTray for the
   *  full state machine + visibility rules. */
  armedCapabilities: ReadonlySet<CapId>;
  enabledCapabilities: ReadonlySet<CapId>;
  /** Free tier / no wallet — tray renders locked regardless of the
   *  enabled set. */
  tierLocked: boolean;
  /** Which action modal is open (parent-side state); the tray uses
   *  it to paint the corresponding icon in its accent hue on click,
   *  so feedback is instant instead of waiting on the intent draft. */
  currentCapabilityAction: CapId | null;
  /** Click on a tray icon → open its action modal (parent renders it). */
  onOpenCapabilityAction: (cap: CapId) => void;
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

  const hasValue = value.trim().length > 0 || tokenPills.length > 0;
  const canSend = hasValue && !isStreaming;

  // Parse the textarea content into a flat array of styled segments:
  // plain text, active-ticker (still being typed `$X…`), or settled
  // pill (recognized token followed by whitespace). The overlay below
  // renders these spans on top of a transparent-text textarea so the
  // pill styling lands AT the typed position in the sentence — the
  // caret + selection still belong to the textarea underneath.
  const overlaySegments = useMemo(() => {
    type Segment =
      | { kind: 'text'; content: string }
      | { kind: 'active'; content: string; symbol: string }
      | { kind: 'pill'; content: string; symbol: string }
      // v0.5.0 — placeholders inserted by the capability tray. Render
      // in muted color so the user reads them as a hint, not committed
      // prose. Matched by an `<angle-bracketed>` pattern anywhere in
      // the input.
      | { kind: 'placeholder'; content: string }
      // v0.5.0 — the send/pay/flow/auto keyword prefix when it sits at
      // word-boundary. Tinted with the capability accent so the
      // command reads structurally without a slash prefix.
      | { kind: 'command'; content: string; cap: CapId }
      // v0.5.1 — a Solana wallet address (base58, 32-44 chars). Tinted
      // green + mono tabular so the user can visually verify the
      // recipient without reading every character. Detected at token
      // granularity BEFORE the command-range flatten so an address
      // inside `send 0.1 SOL → <addr>` still styles.
      | { kind: 'wallet'; content: string };
    const COMMAND_KW: Record<string, CapId> = {
      send: 'transfer',
      pay: 'payment',
    };
    // Precompute which characters of `value` fall inside a command
    // line. Ticker symbols inside a command are rendered as plain
    // text (not pills) so their visual width matches the underlying
    // character metrics — otherwise the caret can't reach past the
    // pill's inflated padding + icon width.
    const COMMAND_RANGE_RE =
      /\b(?:send|pay)\s+\d+(?:\.\d+)?\s+[A-Z0-9]{1,16}(?:\s+(?:→|to)\s*[^\n]*)?/gi;
    const commandRanges: Array<{ start: number; end: number }> = [];
    for (const m of value.matchAll(COMMAND_RANGE_RE)) {
      if (typeof m.index === 'number') {
        commandRanges.push({ start: m.index, end: m.index + m[0].length });
      }
    }
    const inCommand = (pos: number): boolean =>
      commandRanges.some((r) => pos >= r.start && pos < r.end);

    const tokens = value.split(/(\s+)/);
    const out: Segment[] = [];
    let cursor = 0; // running char position into `value`
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i] ?? '';
      const tokStart = cursor;
      cursor += tok.length;
      if (tok.length === 0) continue;
      if (/^\s+$/.test(tok)) {
        // Collapse a whitespace run that follows a confirmed pill
        // (the caret-alignment injector adds 4 extra spaces after
        // ticker + user-typed space). Render only a single visible
        // space here so the overlay text reads as fluid prose while
        // the textarea's underlying width still houses the padding.
        const prev = out[out.length - 1];
        if (prev && (prev.kind === 'pill' || prev.kind === 'active') && tok.length > 1) {
          out.push({ kind: 'text', content: ' ' });
          continue;
        }
        out.push({ kind: 'text', content: tok });
        continue;
      }
      // Angle-bracketed placeholder — always muted.
      if (/^<[a-zA-Z_-]{2,32}>$/.test(tok)) {
        out.push({ kind: 'placeholder', content: tok });
        continue;
      }
      // Capability command keyword — must be at the very start of
      // the token (case-insensitive) and match one of the four verbs.
      const lowerTok = tok.toLowerCase();
      const commandCap = COMMAND_KW[lowerTok];
      if (commandCap && (out.length === 0 || out[out.length - 1]?.kind === 'text')) {
        // Only tint the first occurrence per prompt so noise words
        // ("send it") don't accidentally color mid-sentence text.
        const alreadyTinted = out.some((s) => s.kind === 'command');
        if (!alreadyTinted) {
          out.push({ kind: 'command', content: tok, cap: commandCap });
          continue;
        }
      }
      // v0.5.1 — Solana wallet address. Detected at token level so
      // the styled span replaces exactly the underlying characters
      // (no padding, no pill chrome) → caret metrics stay aligned.
      // Checked BEFORE the command-range flatten so an address
      // pasted after `send 0.1 SOL → ` still gets the green tint.
      if (isWalletAddressToken(tok)) {
        out.push({ kind: 'wallet', content: tok });
        continue;
      }
      // v0.5.0 — never pill-style a symbol that sits inside a command
      // line. Rendering it as a wide pill would break caret metrics
      // (textarea has plain "SOL", overlay would render a padded
      // icon+chip → the → arrow visually drifts past where the caret
      // can reach). Command lines stay flat text throughout.
      if (inCommand(tokStart)) {
        out.push({ kind: 'text', content: tok });
        continue;
      }
      const isCashtag = tok.startsWith('$');
      const stripped = isCashtag ? tok.slice(1) : tok;
      if (/^[A-Za-z0-9]{2,11}$/.test(stripped)) {
        const lower = stripped.toLowerCase();
        const upper = stripped.toUpperCase();
        const symbol =
          knownTickerSet.aliasToSymbol.get(lower) ??
          (knownTickerSet.symbols.has(upper) ? upper : null);
        if (symbol) {
          const next = tokens[i + 1] ?? '';
          const confirmed = /^\s+$/.test(next);
          if (confirmed) {
            out.push({ kind: 'pill', content: tok, symbol });
            continue;
          }
          if (isCashtag) {
            out.push({ kind: 'active', content: tok, symbol });
            continue;
          }
        }
      }
      out.push({ kind: 'text', content: tok });
    }
    return out;
  }, [value, knownTickerSet]);

  // Sync the overlay's scroll with the textarea's. When the textarea
  // overflows its 140px max-height and the user scrolls, the overlay
  // has to ride along or the styled spans drift off the underlying
  // text.
  const overlayRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const ta = inputRef.current;
    const ov = overlayRef.current;
    if (!ta || !ov) return;
    const onScroll = () => {
      ov.scrollTop = ta.scrollTop;
    };
    ta.addEventListener('scroll', onScroll);
    return () => ta.removeEventListener('scroll', onScroll);
  }, [inputRef]);

  // Unique detected symbols — feeds the "detected tickers" strip
  // below the composer. Icons live there so the reveal animation can
  // play without widening the overlay pill (which would drop the
  // caret mid-word). Order-preserving dedupe so the icons appear in
  // the order the user typed them.
  const detectedSymbols = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const seg of overlaySegments) {
      // Only ticker-bearing segments contribute — placeholder + command
      // tokens (v0.5.0 additions) don't map to a coin symbol.
      if (seg.kind !== 'active' && seg.kind !== 'pill') continue;
      if (seen.has(seg.symbol)) continue;
      seen.add(seg.symbol);
      list.push(seg.symbol);
    }
    return list;
  }, [overlaySegments]);

  // Only carousel-picked tickers gate the capability tray — typed
  // pills in the prompt (`$BTC`) don't unlock actions. Rationale:
  // a carousel pick is an explicit "I want to act on this token"
  // signal, whereas typed tickers are just context for prediction.
  // The list is ordered as the user picked them so the first entry
  // is what the command template seeds into the textbox.
  const activeTickerSymbols = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const sym of tokenPills) {
      const upper = sym.toUpperCase();
      if (seen.has(upper)) continue;
      seen.add(upper);
      list.push(upper);
    }
    return list;
  }, [tokenPills]);
  // Which capabilities have a command currently drafted in the
  // textbox — even a partial one like `send 0.1 BTC → ` (no
  // recipient yet). Feeds the tray icon coloring so the $ turns
  // green the moment the template lands, not only after the intent
  // is signed. Keyword must be preceded by whitespace or
  // start-of-string AND followed by an amount, so noise words
  // ("send it back") don't false-match.
  const draftingCapabilities = useMemo(() => {
    const set = new Set<CapId>();
    if (/(?:^|\s)send\s+\d/i.test(value)) set.add('transfer');
    if (/(?:^|\s)pay\s+\d/i.test(value)) set.add('payment');
    return set;
  }, [value]);

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
        'relative flex flex-wrap items-end gap-1.5',
        'rounded-3xl px-3 py-2',
        'border border-[var(--border)]',
        'bg-[color-mix(in_oklab,var(--surface)_18%,transparent)]',
        'backdrop-blur-[10px] backdrop-saturate-[140%]',
        // Focus: brighten the existing hairline (no white). The border
        // moves from --border to a slightly stronger --border-hi token
        // and the surface darkens a touch so the composer reads as
        // "active" without any high-contrast outline competing with
        // the prose inside.
        'focus-within:border-[var(--border-hi)]',
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

      {/* v0.4.1 — Claude-style Directory picker. Opens a menu with the
          wallet's Skills, Connectors, Plugins; activating a skill takes
          effect on the next message without leaving the chat. The
          trigger sits to the left of the textarea so the action surface
          reads in left-to-right order: pick context (skill/connector),
          type, send. The `data-tour-id="composer-topics"` anchor is
          set on the picker's own outer div now (see directory-picker
          v0.5.9) — a wrapper span was collapsing to zero dimensions
          inside the composer's flex row on mobile and the spotlight
          couldn't find the target. */}
      <DirectoryPicker signedIn={signedIn} disabled={isStreaming} />

      {/* Token pill row — sits between the Directory picker and the
          textarea so a typed prompt visually continues from the last
          pill. Each pill carries a CoinIcon (at 70% opacity) +
          uppercase ticker + an "×" to remove. On submit the parent
          concatenates symbols ahead of the typed text and clears the
          row. The pills wrap to a new line when the row overflows so
          the textarea never gets squeezed off-screen. */}
      {tokenPills.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 self-center py-1">
          {tokenPills.map((sym) => (
            <ComposerPill
              key={sym}
              symbol={sym}
              compact={tokenPills.length >= 3}
              onRemove={() => onRemovePill(sym)}
            />
          ))}
        </div>
      )}

      {/* Editable wrapper — uses CSS Grid so the textarea and the
          in-place pill overlay share the EXACT same cell. Both stack
          on top of each other, both wrap the same way, both grow
          height together. No absolute positioning means no layout
          drift that previously pushed the send button off the
          composer chrome. */}
      <div className="grid flex-1 min-w-0 [grid-template-areas:'stack']">
        <div
          ref={overlayRef}
          aria-hidden
          className={cn(
            '[grid-area:stack] pointer-events-none overflow-hidden',
            'px-1.5 py-1.5 max-h-[140px]',
            'text-[14px] text-[var(--fg)] leading-relaxed',
            'whitespace-pre-wrap break-words',
          )}
        >
          {overlaySegments.map((seg, i) => {
            if (seg.kind === 'text') {
              return <span key={i}>{seg.content}</span>;
            }
            if (seg.kind === 'placeholder') {
              // Muted-color hint for angle-bracketed placeholders
              // like `<recipient>` — kept for backward compat with
              // any legacy prompts + user prose that uses them.
              return (
                <span
                  key={i}
                  className="text-[var(--fg-3)] opacity-60"
                >
                  {seg.content}
                </span>
              );
            }
            if (seg.kind === 'command') {
              // Command keyword (send / flow / pay / auto). Tinted
              // in the capability's accent hue so the prompt reads
              // structurally without a slash prefix. `--cap-{id}`
              // lookup is inlined so the token can pull the hue at
              // render time.
              const varName = `--cap-${seg.cap}`;
              return (
                <span
                  key={i}
                  className="font-semibold"
                  style={{ color: `var(${varName})` }}
                >
                  {seg.content}
                </span>
              );
            }
            if (seg.kind === 'wallet') {
              // v0.5.1 — a detected Solana wallet address. Tinted
              // `--up` (same green as the SOL coin icon) + mono
              // tabular so the base58 characters align vertically
              // and the user can eyeball a match against the wallet
              // they meant to type. No background, no border — width
              // stays 1:1 with the underlying textarea character
              // metrics so the caret rides on top cleanly.
              return (
                <span
                  key={i}
                  className="mono tabular font-medium text-[var(--up)]"
                >
                  {seg.content}
                </span>
              );
            }
            // Icon rides absolutely-positioned OUTSIDE the pill span
            // (16px to the left, over the preceding whitespace). It
            // doesn't contribute to the pill's flow width, so the
            // textarea's caret metrics stay aligned with the styled
            // span. The `vz-ticker-icon-reveal` keyframe fires on
            // every fresh mount (per-symbol key on the icon wrapper).
            if (seg.kind === 'active') {
              return (
                <span key={i} className="vz-ticker-active relative">
                  <span
                    key={`${seg.symbol}-active-icon`}
                    className="vz-ticker-icon-reveal absolute left-[3px] top-1/2 -translate-y-1/2 inline-flex items-center"
                    aria-hidden
                  >
                    <CoinIcon symbol={seg.symbol} size={12} />
                  </span>
                  {seg.content}
                </span>
              );
            }
            return (
              <span
                key={`${i}-${seg.content}`}
                className="vz-ticker-pill relative"
              >
                <span
                  key={`${seg.symbol}-pill-icon`}
                  className="vz-ticker-icon-reveal absolute left-[3px] top-1/2 -translate-y-1/2 inline-flex items-center"
                  aria-hidden
                >
                  <CoinIcon symbol={seg.symbol} size={12} />
                </span>
                {seg.content}
              </span>
            );
          })}
        </div>
        <textarea
          ref={inputRef}
          data-tour-id="composer-input"
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={(e) => {
            const cmdEnter = e.key === 'Enter' && (e.metaKey || e.ctrlKey);
            if (cmdEnter) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
              return;
            }
            if (
              e.key === 'Backspace' &&
              value.length === 0 &&
              tokenPills.length > 0
            ) {
              e.preventDefault();
              onRemovePill(tokenPills[tokenPills.length - 1]!);
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
            '[grid-area:stack] resize-none bg-transparent outline-none',
            'text-[14px] leading-relaxed',
            // Hide the textarea's own text so the overlay's styled
            // version is the only thing the user sees. Caret remains
            // visible via `caret-color` so the input still feels live.
            'text-transparent caret-[var(--fg)]',
            'placeholder:text-[var(--fg-3)] placeholder:transition-opacity placeholder:duration-200',
            'focus:placeholder:opacity-60',
            'px-1.5 py-1.5 min-w-0 w-full',
            'max-h-[140px] overflow-y-auto',
            'transition-[height] duration-150 ease-out',
          )}
        />
      </div>

      {/* v0.5.0 — Agent-payment capabilities. The tray only mounts
          when a ticker is active (carousel selection or typed pill).
          When mounted, four icons appear right of the textarea; each
          can be armed to signal "run this capability on submit".
          Free tier / unenabled caps render locked (visible but
          non-interactive) so the affordance is discoverable. */}
      <CapabilityTray
        activeSymbols={activeTickerSymbols}
        armed={armedCapabilities}
        // `drafting` catches the "typing a command right now" state
        // so the tray icon paints its accent as soon as the template
        // lands in the textbox — not only after the intent settles.
        drafting={draftingCapabilities}
        enabled={enabledCapabilities}
        tierLocked={tierLocked}
        disabled={isStreaming}
        currentAction={currentCapabilityAction}
        onOpenAction={onOpenCapabilityAction}
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

type TopicSection = 'tokens' | 'sectors' | 'macro';

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
  /** Which group a topic belongs to in the Add Topic popover. Drives
   *  the section headers + ordering. Defaults to `'sectors'` when a
   *  user-defined custom token doesn't carry an explicit section. */
  section?: TopicSection;
}

/** Ordered list of sections in the Add Topic popover. */
const TOPIC_SECTIONS: ReadonlyArray<TopicSection> = [
  'tokens',
  'sectors',
  'macro',
];

const TOPIC_SECTION_LABEL: Record<TopicSection, string> = {
  tokens: 'Tokens',
  sectors: 'Sectors',
  macro: 'Macro',
};

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
  // Tokens — pre-fill so the user completes the horizon. The bare
  // ticker + trailing space is what lands in the composer; the user
  // types "4h", "1d con funding", etc.
  { id: 'btc', label: 'Bitcoin', ticker: 'BTC', prompt: 'BTC ', behavior: 'insert', section: 'tokens' },
  { id: 'eth', label: 'Ethereum', ticker: 'ETH', prompt: 'ETH ', behavior: 'insert', section: 'tokens' },
  { id: 'sol', label: 'Solana', ticker: 'SOL', prompt: 'SOL ', behavior: 'insert', section: 'tokens' },
  // Mid-2026 rebrand: the carousel chip + composer prompt switch to
  // GRAM. The catalog `id` stays 'ton' so existing users with 'ton' in
  // their localStorage `barIds` keep their chip without an orphan.
  { id: 'ton', label: 'Gram', ticker: 'GRAM', prompt: 'GRAM ', behavior: 'insert', section: 'tokens' },
  // Crypto-native sectors
  { id: 'defi', label: 'DeFi', icon: 'liquid', prompt: 'DeFi sector update', behavior: 'submit', section: 'sectors' },
  { id: 'l2', label: 'L2s', icon: 'stack', prompt: 'Layer 2 ecosystem update', behavior: 'submit', section: 'sectors' },
  { id: 'memes', label: 'Memes', icon: 'dice', prompt: 'Top memecoins trending now', behavior: 'submit', section: 'sectors' },
  { id: 'ai', label: 'AI agents', icon: 'chip', prompt: 'AI agents in crypto', behavior: 'submit', section: 'sectors' },
  { id: 'depin', label: 'DePIN', icon: 'mesh', prompt: 'DePIN trends and tokens', behavior: 'submit', section: 'sectors' },
  { id: 'rwa', label: 'RWA', icon: 'building', prompt: 'Real-world asset tokens', behavior: 'submit', section: 'sectors' },
  { id: 'restaking', label: 'Restaking', icon: 'cycle', prompt: 'Restaking trends and yields', behavior: 'submit', section: 'sectors' },
  { id: 'pre-news', label: 'Pre-news', icon: 'radar', prompt: 'Pre-news signals firing now', behavior: 'submit', section: 'sectors' },
  // Catalysts that move crypto
  { id: 'macro', label: 'Macro', icon: 'globe', prompt: 'Macro outlook — Fed, DXY, rates, and crypto impact', behavior: 'submit', section: 'macro' },
  { id: 'etfs', label: 'ETF flows', icon: 'bars', prompt: 'Latest BTC and ETH spot ETF net flows', behavior: 'submit', section: 'macro' },
  { id: 'regulation', label: 'Regulation', icon: 'shield', prompt: 'Crypto regulation watch — SEC, MiCA, Korea', behavior: 'submit', section: 'macro' },
  { id: 'stables', label: 'Stables', icon: 'anchor', prompt: 'Stablecoin supply changes and depeg risk', behavior: 'submit', section: 'macro' },
  { id: 'geopolitics', label: 'Geopolitics', icon: 'flag', prompt: 'Geopolitics and crypto — sanctions, capital flight', behavior: 'submit', section: 'macro' },
  { id: 'stocks', label: 'Stocks tape', icon: 'bars', prompt: 'Crypto-correlated stocks — MSTR, COIN, NVDA', behavior: 'submit', section: 'macro' },
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
  'btc',
  'eth',
  'sol',
  'ton',
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

/**
 * Hidden-topic ids — the user explicitly removed these from the Add
 * Topic popover via the row "×". They still exist in the catalog and
 * can be restored from the popover's "Hidden" section, but they don't
 * clutter the main grouped list anymore.
 *
 * Versioned key mirrors the other stores so the schema can evolve
 * without colliding with old client data.
 */
const HIDDEN_TOPICS_KEY = 'vizzor.predict.hidden-topics.v1';

interface StoredHiddenTopics {
  v: 1;
  ids: ReadonlyArray<string>;
}

function loadHiddenTopicIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HIDDEN_TOPICS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredHiddenTopics | null;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.ids)) return [];
    const valid: string[] = [];
    const seen = new Set<string>();
    for (const id of parsed.ids) {
      if (typeof id !== 'string') continue;
      if (seen.has(id)) continue;
      seen.add(id);
      valid.push(id);
    }
    return valid;
  } catch {
    return [];
  }
}

function saveHiddenTopicIds(ids: ReadonlyArray<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      HIDDEN_TOPICS_KEY,
      JSON.stringify({ v: 1, ids } satisfies StoredHiddenTopics),
    );
  } catch {
    // Best-effort.
  }
}

/**
 * Permanently-removed topic ids — the user has explicitly deleted these
 * from the popover via the row Trash button. Unlike the Hidden bucket
 * (which is reversible from within the popover), removed topics do
 * NOT reappear in a "removed" section — the intent is data hygiene, so
 * they're just gone from the picker. For `custom-*` ids we also drop
 * the underlying symbol from `customTokens`; for built-ins the id just
 * lives in this list until the user resets the picker from settings.
 */
const REMOVED_TOPICS_KEY = 'vizzor.predict.removed-topics.v1';

interface StoredRemovedTopics {
  v: 1;
  ids: ReadonlyArray<string>;
}

function loadRemovedTopicIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(REMOVED_TOPICS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredRemovedTopics | null;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.ids)) return [];
    const valid: string[] = [];
    const seen = new Set<string>();
    for (const id of parsed.ids) {
      if (typeof id !== 'string') continue;
      if (seen.has(id)) continue;
      seen.add(id);
      valid.push(id);
    }
    return valid;
  } catch {
    return [];
  }
}

function saveRemovedTopicIds(ids: ReadonlyArray<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      REMOVED_TOPICS_KEY,
      JSON.stringify({ v: 1, ids } satisfies StoredRemovedTopics),
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
  // TON → GRAM rebrand (mid-2026). Legacy mentions still resolve to
  // the new symbol so detection upstream stays consistent without
  // forcing a sweep of every i18n string + user-side chip catalog.
  toncoin: 'GRAM',
  ton: 'GRAM',
  gram: 'GRAM',
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
 *   2. Bare uppercase tokens (3-10 chars) — DASH, LINK, AVAX, etc.
 *      Filtered against `STOPLIST` to drop common acronyms (USD, API,
 *      FAQ) that aren't crypto tickers. We previously gated this on a
 *      known-symbols set, which meant any coin outside the top-20 was
 *      silently dropped — now we let everything through and the
 *      downstream price lookup decides whether to render a chip.
 *   3. Friendly names (`bitcoin`, `Solana`) → mapped via
 *      TICKER_NAME_MAP.
 *
 * Order preserved (first mention wins) so banners stack in the order
 * the user thought about them.
 */
/**
 * Walk every user turn, extract ticker symbols, and return the ones
 * that aren't already covered by the standard TOP_20 ticker. The
 * shell feeds the result into `useExtraTickers` so the inline chip
 * works for arbitrary coins (DASH, LINK, AVAX, …) without forcing the
 * default ticker request to grow unbounded.
 *
 * The return value is sorted + deduped so the SWR cache key is stable
 * across re-renders (otherwise we'd re-fetch on every render even
 * when the symbol set is unchanged).
 */
function useExtraSymbolsFromMessages(
  messages: ReadonlyArray<{ role: string; parts: ReadonlyArray<unknown> }>,
  baseSymbols: ReadonlySet<string>,
): ReadonlyArray<string> {
  return useMemo(() => {
    const out = new Set<string>();
    for (const m of messages) {
      if (m.role !== 'user') continue;
      const text = (m.parts as ReadonlyArray<{ type?: string; text?: string }>)
        .filter((p) => p?.type === 'text')
        .map((p) => p?.text ?? '')
        .join(' ');
      for (const sym of extractTickersFromText(text)) {
        if (!baseSymbols.has(sym)) out.add(sym);
      }
    }
    return [...out].sort();
  }, [messages, baseSymbols]);
}

function extractTickersFromText(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (sym: string): void => {
    const up = sym.toUpperCase();
    if (seen.has(up)) return;
    if (TICKER_STOPLIST.has(up)) return;
    seen.add(up);
    out.push(up);
  };
  // $TICKER pattern — case-insensitive.
  for (const m of text.matchAll(DOLLAR_TICKER_RE)) {
    if (m[1]) push(m[1]);
  }
  // Bare uppercase ticker — 3+ chars to drop tiny English words
  // ("TO", "BY", "EN") that would otherwise match the regex.
  for (const m of text.matchAll(BARE_TICKER_RE)) {
    if (m[1] && m[1].length >= 3) push(m[1]);
  }
  // Friendly names — case-insensitive whole-word scan.
  const lower = text.toLowerCase();
  for (const [name, sym] of Object.entries(TICKER_NAME_MAP)) {
    const re = new RegExp(`\\b${name}\\b`, 'i');
    if (re.test(lower)) push(sym);
  }
  return out;
}

/**
 * Common ALL-CAPS acronyms that pass the regex but are clearly not
 * crypto tickers. Conservative on purpose — when in doubt, let it
 * through and the price-lookup miss takes care of the rest. The cost
 * of a false positive is one extra symbol in the lazy-lookup batch.
 */
const TICKER_STOPLIST: ReadonlySet<string> = new Set([
  'API', 'RPC', 'USA', 'USB', 'EUR', 'GBP', 'JPY', 'YEN', 'CHF',
  'EST', 'PST', 'UTC', 'GMT', 'CEST',
  'ETA', 'FAQ', 'TBD', 'TBA', 'NSFW', 'LOL', 'OMG', 'WTF',
  'FYI', 'ASAP', 'BRB', 'IMO', 'BTW', 'IDK', 'AKA', 'IIRC',
  'PDF', 'CSV', 'JSON', 'HTML', 'CSS', 'SQL', 'URL', 'HTTP', 'HTTPS',
  'TODO', 'DONE', 'WIP', 'CEO', 'CTO', 'CFO',
]);

/** Produce a TopicSpec for a user-defined token symbol. */
function customTokenToSpec(symbol: string): TopicSpec {
  const up = symbol.toUpperCase();
  return {
    id: `custom-${up}`,
    label: up,
    ticker: up,
    prompt: `${up} `,
    behavior: 'insert',
    section: 'tokens',
  };
}

function ChatTopics({
  onSubmit,
  onInsert,
}: {
  /** Fire-and-forget submit — used for `behavior: 'submit'` chips. */
  onSubmit: (prompt: string) => void;
  /** Pre-fill composer + focus — used for `behavior: 'insert'` chips.
   *  `meta.ticker` is forwarded so the parent can decide between
   *  rendering a visual token pill (for coins) vs. seeding the
   *  textarea with plain text (everything else). */
  onInsert: (seed: string, meta: { ticker?: string }) => void;
}) {
  // Hydrated lazily on mount so SSR doesn't see localStorage and the
  // first paint matches the default layout. The reorder/add/remove
  // handlers then mutate this state and persist on every change.
  const [barIds, setBarIds] = useState<string[]>(() => [...DEFAULT_BAR_IDS]);
  const [customTokens, setCustomTokens] = useState<string[]>(() => []);
  const [hiddenTopicIds, setHiddenTopicIds] = useState<string[]>(() => []);
  const [removedTopicIds, setRemovedTopicIds] = useState<string[]>(() => []);
  const [hydrated, setHydrated] = useState(false);
  /**
   * Tracks the id of the chip that was just added via the picker so
   * the SortableTopicChip can play a one-shot "slide in from the left"
   * animation instead of popping into existence. Cleared after the
   * keyframe duration so subsequent mounts (e.g., rehydration) don't
   * replay it. The animation itself lives in globals.css.
   */
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  useEffect(() => {
    setBarIds(loadBarIds());
    setCustomTokens(loadCustomTokens());
    setHiddenTopicIds(loadHiddenTopicIds());
    setRemovedTopicIds(loadRemovedTopicIds());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) saveBarIds(barIds);
  }, [barIds, hydrated]);
  useEffect(() => {
    if (hydrated) saveCustomTokens(customTokens);
  }, [customTokens, hydrated]);
  useEffect(() => {
    if (hydrated) saveHiddenTopicIds(hiddenTopicIds);
  }, [hiddenTopicIds, hydrated]);
  useEffect(() => {
    if (hydrated) saveRemovedTopicIds(removedTopicIds);
  }, [removedTopicIds, hydrated]);

  const onHideTopic = useCallback((id: string) => {
    setHiddenTopicIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);
  const onRestoreTopic = useCallback((id: string) => {
    setHiddenTopicIds((prev) => prev.filter((x) => x !== id));
  }, []);
  /**
   * Permanent removal. For custom (`custom-SYMBOL`) tokens we drop the
   * underlying symbol from `customTokens` so it's fully gone — no
   * ghost row in Hidden, no reappearance on next mount. For built-ins
   * we track the id so the picker filters it out. Both branches also
   * clear the id from the hidden list so we don't leak dangling state.
   */
  const onRemoveTopic = useCallback((id: string) => {
    if (id.startsWith('custom-')) {
      const symbol = id.slice('custom-'.length).toUpperCase();
      setCustomTokens((list) => list.filter((s) => s !== symbol));
    }
    setRemovedTopicIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setHiddenTopicIds((prev) => prev.filter((x) => x !== id));
    setBarIds((ids) => ids.filter((x) => x !== id));
  }, []);

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
    // Custom-token ids (`custom-LTC`, `custom-DOGE`, …) need the
    // matching symbol registered in `customTokens` so that
    // `allTopicsById[id]` resolves on the next render — otherwise
    // the bar's `if (!topic) return null` guard silently drops the
    // chip and the user sees no feedback after a click. This path
    // fires when a TOP_20 or live-lookup search result is picked
    // from the popover (those rows arrive with a `custom-*` id but
    // never went through `addCustomToken`).
    if (id.startsWith('custom-')) {
      const symbol = id.slice('custom-'.length).toUpperCase();
      if (CUSTOM_TOKEN_SYMBOL_RE.test(symbol)) {
        setCustomTokens((list) =>
          list.includes(symbol) ? list : [...list, symbol],
        );
      }
    }
    // Prepend so the just-added chip lands at the front of the
    // carousel — matches the "your latest pick lives closest to the
    // composer" mental model and pairs with the slide-in keyframe on
    // SortableTopicChip. Re-adds move the existing id to the front too.
    setBarIds((ids) => [id, ...ids.filter((x) => x !== id)]);
    setJustAddedId(id);
    // Clear the flag after the keyframe so future remounts don't replay.
    // 500ms is the keyframe duration + a small tail for the ease-out.
    window.setTimeout(() => {
      setJustAddedId((current) => (current === id ? null : current));
    }, 500);
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
        setBarIds((ids) => [builtin.id, ...ids.filter((x) => x !== builtin.id)]);
        setJustAddedId(builtin.id);
        window.setTimeout(() => {
          setJustAddedId((current) => (current === builtin.id ? null : current));
        }, 500);
        return builtin.id;
      }
      setCustomTokens((list) => (list.includes(up) ? list : [...list, up]));
      setBarIds((ids) => [spec.id, ...ids.filter((x) => x !== spec.id)]);
      setJustAddedId(spec.id);
      window.setTimeout(() => {
        setJustAddedId((current) => (current === spec.id ? null : current));
      }, 500);
      return spec.id;
    },
    [],
  );

  const available = useMemo(() => {
    const merged = [...TOPICS_CATALOG, ...customSpecs];
    const removedSet = new Set(removedTopicIds);
    return merged.filter((t) => !barIds.includes(t.id) && !removedSet.has(t.id));
  }, [barIds, customSpecs, removedTopicIds]);

  const onChipPick = useCallback(
    (topic: TopicSpec) => {
      if (topic.behavior === 'insert') {
        onInsert(topic.prompt, { ticker: topic.ticker });
      } else {
        onSubmit(topic.prompt);
      }
    },
    [onInsert, onSubmit],
  );

  return (
    <nav
      aria-label="Prompt suggestions"
      data-tour-id="topic-carousel"
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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            /* MeasuringStrategy.Always re-measures droppable rects on
               every render, which is what lets dnd-kit's useSortable
               animate the "existing chips slide right" transform when
               we programmatically prepend a new id via addChip. Without
               this, layout is only measured at drag start, so a
               programmatic reorder would relayout instantly (jarring
               against the new-chip slide-in). Slight extra work per
               render but the chip count is small (~4-8 items). */
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          >
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
                      livePrice={live?.price}
                      liveChangePct={live?.changePct}
                      justAdded={justAddedId === id}
                      position={idx}
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
              hiddenIds={hiddenTopicIds}
              onAdd={addChip}
              onAddCustom={addCustomToken}
              onHide={onHideTopic}
              onRestore={onRestoreTopic}
              onRemove={onRemoveTopic}
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
  livePrice,
  liveChangePct,
  justAdded = false,
  position,
}: {
  topic: TopicSpec;
  onPick: (topic: TopicSpec) => void;
  onRemove: (id: string) => void;
  /** Live spot price for the chip's ticker, when available. Ignored
   *  for non-ticker chips. */
  livePrice?: number;
  /** Fractional 24h change (e.g. -0.021 = -2.1%). */
  liveChangePct?: number;
  /** When true, play the one-shot slide-in-from-picker keyframe on
   *  mount. Set by the parent for exactly one chip at a time — the id
   *  that was just added via the (+) popover. */
  justAdded?: boolean;
  /** Current index in `barIds`. Only used as a signal — position 0
   *  means "the chip just landed at the front", so the parent only
   *  flags justAdded=true when position is 0. Kept as a prop so the
   *  memoization key follows the layout, not just the id. */
  position: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: topic.id });

  // Merge dnd-kit's drag transform with a subtle mount-position offset
  // so the new-at-front chip flies in from the left. The offset applies
  // ONLY when justAdded is true; after the CSS keyframe finishes the
  // parent clears the flag, so subsequent renders use the plain
  // dnd-kit transform without the mount kick.
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
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'shrink-0 relative group/chip',
        isDragging && 'z-10',
        // One-shot slide-in when the chip was just added via the (+)
        // popover. The keyframe (`.vz-topic-chip-in` in globals.css)
        // sweeps the chip in from the left with a soft fade + tiny
        // scale bump so the user sees "your pick just landed at the
        // front" as one motion instead of a static pop-in. The
        // global @media (prefers-reduced-motion: reduce) block in
        // globals.css collapses the keyframe to ~0ms for users who
        // opt out, so no `motion-safe:` prefix is needed here.
        justAdded && position === 0 && 'vz-topic-chip-in',
      )}
    >
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
          'border border-[var(--border)] text-[var(--fg-2)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] hover:border-[var(--border-hi)]',
          isDragging && 'opacity-80 cursor-grabbing shadow-[0_6px_18px_-8px_color-mix(in_oklab,var(--fg)_45%,transparent)]',
        )}
      >
        <span
          aria-hidden
          className="inline-flex items-center justify-center shrink-0 text-[var(--fg-3)]"
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
            <span className="mono tabular font-medium text-[var(--fg-3)]">
              {formatChipPrice(livePrice)}
            </span>
            {deltaPct !== null && Number.isFinite(deltaPct) && (
              <span
                className={cn(
                  'mono tabular text-[10.5px] font-semibold',
                  isUp ? 'text-[var(--up)]' : 'text-[var(--down)]',
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
  hiddenIds,
  onAdd,
  onAddCustom,
  onHide,
  onRestore,
  onRemove,
  onClose,
  closing = false,
}: {
  available: ReadonlyArray<TopicSpec>;
  /** Ids the user has explicitly hidden from the popover. Their rows
   *  move to the bottom "Hidden" section instead of disappearing. */
  hiddenIds: ReadonlyArray<string>;
  onAdd: (id: string) => void;
  /** Add a user-defined token by symbol. Returns the spec id on
   *  success, null when the symbol failed validation. */
  onAddCustom: (rawSymbol: string) => string | null;
  /** Move a topic from the main sections into the Hidden bucket. */
  onHide: (id: string) => void;
  /** Bring a topic out of the Hidden bucket. The row reappears in
   *  its original section the next render. */
  onRestore: (id: string) => void;
  /** Permanent removal. For custom tokens this drops the underlying
   *  symbol entirely; for built-ins the row is filtered out of every
   *  bucket. Not reversible from within the popover. */
  onRemove: (id: string) => void;
  onClose: () => void;
  /** When true, render the slide-out keyframe instead of slide-in. The
   *  parent keeps the panel mounted for ~160ms so the exit animation
   *  reads as decisive instead of snapping to unmount. */
  closing?: boolean;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [customInput, setCustomInput] = useState('');
  const [customError, setCustomError] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Static-catalog tickers already in `available` — used to dedupe
  // TOP_20 token suggestions against (don't surface BTC twice when
  // typing "bit").
  const staticTickers = useMemo(() => {
    const s = new Set<string>();
    for (const t of available) {
      if (t.ticker) s.add(t.ticker.toUpperCase());
    }
    return s;
  }, [available]);

  // TOP_20 token matches — by symbol OR friendly name. Surfaces
  // recognizable coins (DOGE, ADA, LINK, …) the static catalog
  // doesn't carry, each carrying its real icon via CoinIcon.
  const top20TokenHits = useMemo<TopicSpec[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return TOP_20.filter(
      (c) =>
        c.symbol.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q),
    )
      .filter((c) => !staticTickers.has(c.symbol))
      .map<TopicSpec>((c) => ({
        id: `custom-${c.symbol}`,
        label: c.name,
        ticker: c.symbol,
        prompt: `${c.symbol} `,
        behavior: 'insert',
        section: 'tokens',
      }));
  }, [query, staticTickers]);

  // Live engine lookup for arbitrary tickers (DASH, PEPE, RNDR, …) —
  // only fires when the query looks like a ticker AND neither the
  // static catalog nor TOP_20 covers it. SWR keys are stable per
  // uppercased query so two consecutive keystrokes with the same
  // tail share the request.
  const upperQuery = query.trim().toUpperCase();
  const needsLiveLookup =
    /^[A-Z0-9]{3,11}$/.test(upperQuery) &&
    !TOP_20_BY_SYMBOL[upperQuery] &&
    !staticTickers.has(upperQuery);

  const { data: liveTicker } = useSWR<TickerEntry[]>(
    needsLiveLookup ? `/api/ticker?symbols=${upperQuery}` : null,
    (url: string) => fetch(url).then((r) => r.json()),
    { dedupingInterval: 15_000, revalidateOnFocus: false },
  );

  const liveTokenHit = useMemo<TopicSpec | null>(() => {
    if (!needsLiveLookup) return null;
    const entry = liveTicker?.find(
      (e) => e.symbol.toUpperCase() === upperQuery,
    );
    if (!entry) return null;
    return {
      id: `custom-${upperQuery}`,
      label: upperQuery,
      ticker: upperQuery,
      prompt: `${upperQuery} `,
      behavior: 'insert',
      section: 'tokens',
    };
  }, [liveTicker, needsLiveLookup, upperQuery]);

  // Filter the catalog by query. The same input is used as both the
  // section-list filter AND the custom-token field — typing a query
  // narrows the list live; if Enter doesn't match an existing row, we
  // try to add it as a custom token. Keeps the popover surface lean.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const staticHits = q
      ? available.filter(
          (t) =>
            t.label.toLowerCase().includes(q) ||
            (t.ticker ? t.ticker.toLowerCase().includes(q) : false),
        )
      : available;
    if (!q) return staticHits;
    // Token search hits land in the Tokens section. Live hit takes
    // priority (most specific match for what the user typed), then
    // the TOP_20 catalog hits.
    return [
      ...staticHits,
      ...(liveTokenHit ? [liveTokenHit] : []),
      ...top20TokenHits,
    ];
  }, [available, query, top20TokenHits, liveTokenHit]);

  // Partition filtered rows by hidden state. Hidden rows render in a
  // dedicated bucket at the bottom of the popover; main sections only
  // show non-hidden rows.
  const hiddenSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const visibleFiltered = useMemo(
    () => filtered.filter((t) => !hiddenSet.has(t.id)),
    [filtered, hiddenSet],
  );
  const hiddenItems = useMemo(
    () => filtered.filter((t) => hiddenSet.has(t.id)),
    [filtered, hiddenSet],
  );

  // Group filtered rows by section so the popover renders one block
  // per concept (Vizzor / Tokens / Sectors / Macro). Empty sections
  // disappear cleanly — no header without rows.
  const grouped = useMemo(() => {
    const map = new Map<TopicSection, TopicSpec[]>();
    for (const t of visibleFiltered) {
      const sec = t.section ?? 'sectors';
      const bucket = map.get(sec);
      if (bucket) bucket.push(t);
      else map.set(sec, [t]);
    }
    return TOPIC_SECTIONS.flatMap((sec) => {
      const items = map.get(sec);
      if (!items || items.length === 0) return [];
      return [{ section: sec, items } as const];
    });
  }, [visibleFiltered]);

  // Flat ordering across sections — drives the keyboard nav so ↑/↓
  // walks the visible rows regardless of which section they're in.
  // Hidden rows are excluded from the keyboard nav (they're a meta
  // affordance, not a primary add target).
  const flatRows = useMemo(
    () => grouped.flatMap((g) => g.items),
    [grouped],
  );

  const submitCustom = useCallback(
    (rawOverride?: string) => {
      const trimmed = (rawOverride ?? customInput).trim();
      if (!trimmed) return;
      const id = onAddCustom(trimmed);
      if (id) {
        setCustomInput('');
        setQuery('');
        setCustomError(false);
        onClose();
      } else {
        setCustomError(true);
      }
    },
    [customInput, onAddCustom, onClose],
  );

  // Keep the active index in bounds as the filter shrinks the list.
  useEffect(() => {
    if (activeIdx >= flatRows.length) {
      setActiveIdx(flatRows.length === 0 ? 0 : flatRows.length - 1);
    }
  }, [activeIdx, flatRows.length]);

  // Reset selection to the first row whenever the query changes — the
  // user just narrowed the result set, focusing on what's still visible.
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Autofocus the search input on mount so the user can start typing
  // straight away. requestAnimationFrame so the input has mounted by
  // the time we ask for focus.
  useEffect(() => {
    const h = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(h);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      const target = e.target as HTMLElement | null;
      const inSearch = target === searchRef.current;
      // Search input handles its own Enter (try the active row, else
      // add as a custom token) — done below in the onKeyDown handler
      // on the input itself. Don't double-dispatch.
      if (target?.tagName === 'INPUT' && !inSearch) return;
      if (target?.tagName === 'TEXTAREA') return;
      if (flatRows.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(flatRows.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      }
    };
    const onClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-topic-add-panel]')) return;
      if (target?.closest('[aria-haspopup="menu"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onClick);
    };
  }, [flatRows, onClose]);

  // Scroll the focused row into view as the user arrow-navigates.
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const inputLooksLikeToken = /^[A-Za-z0-9]{2,11}$/.test(query.trim());

  return (
    <div
      data-topic-add-panel
      role="menu"
      aria-label="Add topic to bar"
      className={cn(
        'absolute z-30',
        'right-0 bottom-full mb-2',
        'w-[300px]',
        'rounded-xl border border-[var(--border)]',
        'bg-[var(--surface)]',
        'shadow-[0_8px_30px_rgba(0,0,0,0.40)]',
        'overflow-hidden flex flex-col',
        'motion-safe:will-change-transform',
        closing
          ? 'motion-safe:slash-palette-slide-out'
          : 'motion-safe:slash-palette-slide-in',
      )}
    >
      {/* Local keyframes for the content-swap transition. Namespaced
          (vt-tap-*) so they don't collide with sibling components. */}
      <style>{`
        @keyframes vt-tap-in {
          from { opacity: 0; transform: translateY(3px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Header — eyebrow + dual-purpose search/token input. Typing
          filters the section list AND, on Enter, tries to add the
          query as a custom token when no row matches. One field, two
          intents, zero extra chrome. */}
      <div className="px-3 pt-2.5 pb-2 border-b border-[var(--border)]">
        <p className="mono tabular text-[10px] uppercase tracking-[0.16em] font-semibold text-[var(--fg-3)]">
          Add topic
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // First try to land on the active row; if none, fall back
            // to treating the query as a custom token symbol.
            const picked = flatRows[activeIdx];
            if (picked) {
              onAdd(picked.id);
              return;
            }
            if (inputLooksLikeToken) submitCustom(query);
            else setCustomError(true);
          }}
          className={cn(
            'mt-2 flex items-center gap-1.5 h-8 px-2 rounded-md border',
            'bg-[var(--bg)] transition-colors duration-150',
            customError
              ? 'border-[var(--danger)]'
              : 'border-[var(--border)] focus-within:border-[var(--border-hi)]',
          )}
        >
          <span aria-hidden className="mono tabular text-[11px] text-[var(--fg-3)] shrink-0">$</span>
          <input
            ref={searchRef}
            type="text"
            value={query.length > 0 ? query : customInput}
            onChange={(e) => {
              setQuery(e.target.value);
              setCustomInput(e.target.value);
              if (customError) setCustomError(false);
            }}
            placeholder="Search or add token…"
            aria-label="Search topics or add a custom token"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="characters"
            className={cn(
              'flex-1 min-w-0 bg-transparent outline-none',
              'mono tabular text-[12.5px] tracking-tight text-[var(--fg)]',
              'placeholder:text-[var(--fg-3)] placeholder:normal-case placeholder:tracking-normal placeholder:font-normal',
            )}
            maxLength={32}
          />
          {/* Submit affordance — only when the query looks like a token
              symbol AND no rows matched. When rows ARE present the
              Enter key picks the active row, so the (+) would be
              misleading. */}
          {inputLooksLikeToken && flatRows.length === 0 && (
            <button
              type="submit"
              aria-label="Add token"
              className={cn(
                'shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-full',
                'text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]',
                'transition-colors duration-150',
              )}
            >
              <svg width={10} height={10} viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
              </svg>
            </button>
          )}
        </form>
      </div>

      {/* Scroll viewport — keyed by query so the content-swap animation
          re-runs on every filter narrow/widen. The wrap is also keyed by
          query length to defeat React's render reuse and force a fresh
          fade-in (otherwise React reuses the same DOM and the animation
          doesn't replay). */}
      <div
        ref={listRef}
        className="max-h-[320px] overflow-y-auto py-1.5"
      >
        {flatRows.length === 0 && hiddenItems.length === 0 ? (
          <div className="px-3 py-3 flex flex-col gap-1.5">
            <p className="text-[12.5px] leading-snug text-[var(--fg-3)]">
              {query.trim()
                ? needsLiveLookup && liveTicker === undefined
                  ? `Searching for ${upperQuery}…`
                  : inputLooksLikeToken
                    ? 'No topic matches. Press Enter to add as a token.'
                    : 'No matching topic.'
                : 'Every topic is already in the bar.'}
            </p>
          </div>
        ) : (
          <div
            key={`${query.length}-${flatRows.length}-${hiddenItems.length}`}
            className="motion-safe:animate-[vt-tap-in_160ms_ease-out]"
          >
            {grouped.map((g) => {
              const first = g.items[0];
              const startIdx = first ? flatRows.indexOf(first) : 0;
              return (
                <section key={g.section} className="px-1 pt-1.5 first:pt-0">
                  <p className="px-2 pt-1 pb-0.5 mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]/80">
                    {TOPIC_SECTION_LABEL[g.section]}
                  </p>
                  <ul role="group">
                    {g.items.map((t, localIdx) => {
                      const idx = startIdx + localIdx;
                      const active = idx === activeIdx;
                      return (
                        <li key={t.id}>
                          <TopicRow
                            topic={t}
                            active={active}
                            dataIdx={idx}
                            onMouseEnter={() => setActiveIdx(idx)}
                            onActivate={() => onAdd(t.id)}
                            onHide={() => onHide(t.id)}
                            onRemove={() => onRemove(t.id)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}

            {/* Hidden bucket — surfaces removed-from-popover topics so
                the action is reversible. Single-click on a hidden row
                restores it back into its original section above. */}
            {hiddenItems.length > 0 && (
              <section className="px-1 pt-3 mt-2 border-t border-[var(--border)]/70">
                <p className="px-2 pt-1 pb-0.5 mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]/80">
                  Hidden · {hiddenItems.length}
                </p>
                <ul role="group">
                  {hiddenItems.map((t) => (
                    <li key={t.id}>
                      <HiddenTopicRow
                        topic={t}
                        onRestore={() => onRestore(t.id)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Visible topic row — primary click activates (adds to bar and animates
 * the new chip to the front of the carousel). The right-side toolbar
 * carries two data-hygiene affordances the user can reach without
 * hovering (touch-friendly):
 *
 *   1. Hide     — moves the row to the reversible Hidden bucket.
 *   2. Remove   — permanent delete; custom tokens drop from local
 *                 storage, built-ins are filtered out of every bucket.
 *
 * The toolbar sits side-by-side with the primary click target so the
 * hit areas don't fight each other. Icons brighten on row hover.
 */
function TopicRow({
  topic,
  active,
  dataIdx,
  onMouseEnter,
  onActivate,
  onHide,
  onRemove,
}: {
  topic: TopicSpec;
  active: boolean;
  dataIdx: number;
  onMouseEnter: () => void;
  onActivate: () => void;
  onHide: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      className={cn(
        'group relative flex items-center rounded-md',
        'transition-[background-color,color] duration-150',
        'before:absolute before:left-0 before:top-1.5 before:bottom-1.5',
        'before:w-[2px] before:rounded-r-full',
        'before:transition-colors before:duration-150',
        active
          ? 'bg-[color-mix(in_oklab,var(--fg)_4%,transparent)] before:bg-[var(--fg)]'
          : 'before:bg-transparent hover:bg-[var(--surface-2)]',
      )}
    >
      <button
        type="button"
        role="menuitem"
        data-idx={dataIdx}
        onClick={onActivate}
        className={cn(
          'flex-1 min-w-0 flex items-center gap-2.5 px-2 py-1.5 text-left',
          'text-[12.5px] leading-[1.35]',
          active ? 'text-[var(--fg)]' : 'text-[var(--fg-2)] group-hover:text-[var(--fg)]',
        )}
      >
        <span aria-hidden className="inline-flex items-center justify-center shrink-0 w-5 h-5 text-[var(--fg-3)] transition-transform duration-150 group-hover:scale-[1.04]">
          {topic.ticker ? (
            <CoinIcon symbol={topic.ticker} size={16} />
          ) : topic.icon ? (
            <TopicIcon kind={topic.icon} size={14} />
          ) : (
            <TopicIcon kind="spark" size={14} />
          )}
        </span>
        <span className="flex-1 truncate">{topic.label}</span>
      </button>
      <div className="shrink-0 flex items-center gap-0.5 pr-1">
        <TopicRowIconButton
          onClick={onHide}
          label={`Hide ${topic.label}`}
          tone="muted"
        >
          {/* Eye-off — hide from picker (reversible from Hidden bucket). */}
          <svg
            width={12}
            height={12}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M2 8s2.2-4 6-4c1.2 0 2.3.4 3.2 1M14 8s-2.2 4-6 4c-1.2 0-2.3-.4-3.2-1" />
            <path d="M10.5 6.6a2.5 2.5 0 0 0-3.9 3.1" />
            <path d="M2 2l12 12" />
          </svg>
        </TopicRowIconButton>
        <TopicRowIconButton
          onClick={onRemove}
          label={`Remove ${topic.label}`}
          tone="danger"
        >
          {/* Trash — permanent delete; different tone so it reads as
              the "no coming back" affordance. */}
          <svg
            width={11}
            height={11}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M3 4h10" />
            <path d="M6 4V2.5h4V4" />
            <path d="M4.5 4l.5 9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-9" />
            <path d="M7 6.5v5M9 6.5v5" />
          </svg>
        </TopicRowIconButton>
      </div>
    </div>
  );
}

/**
 * Small icon-only button used inside each `TopicRow` for the pin/hide/
 * remove toolbar. Kept tiny (18×18) so the three of them line up
 * comfortably in the row's right gutter without pushing the label
 * off-screen on 300px popover widths.
 */
function TopicRowIconButton({
  onClick,
  label,
  children,
  active = false,
  tone = 'muted',
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  /** Pressed state — used by the pin toggle so the star reads as
   *  "currently on". Adds a stronger tint at rest. */
  active?: boolean;
  /** Colour ramp for the icon. `danger` uses --danger on hover so the
   *  Remove affordance reads as the destructive one. */
  tone?: 'muted' | 'accent' | 'danger';
}) {
  const toneClass =
    tone === 'accent'
      ? active
        ? 'text-[var(--accent)]'
        : 'text-[var(--fg-3)] hover:text-[var(--accent)]'
      : tone === 'danger'
        ? 'text-[var(--fg-3)] hover:text-[var(--danger)]'
        : 'text-[var(--fg-3)] hover:text-[var(--fg)]';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      aria-pressed={active || undefined}
      title={label}
      className={cn(
        'inline-flex items-center justify-center h-[22px] w-[22px] rounded-md',
        'transition-[color,background-color,opacity] duration-150',
        'opacity-70 group-hover:opacity-100 focus-visible:opacity-100',
        'hover:bg-[var(--surface)]',
        toneClass,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Hidden-bucket row — muted styling and a quiet restore affordance on
 * the right. Clicking the row body restores the topic back to its
 * original section (does NOT auto-add to the bar — that would shortcut
 * the add gesture and the user might just want to clean up). The
 * restore icon makes the affordance discoverable on touch where hover
 * doesn't fire.
 */
function HiddenTopicRow({
  topic,
  onRestore,
}: {
  topic: TopicSpec;
  onRestore: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRestore}
      aria-label={`Restore ${topic.label}`}
      title={`Restore ${topic.label}`}
      className={cn(
        'group w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
        'text-[12.5px] leading-[1.35] text-[var(--fg-3)]',
        'opacity-70 hover:opacity-100',
        'hover:bg-[var(--surface-2)] hover:text-[var(--fg-2)]',
        'transition-[background-color,color,opacity] duration-150',
      )}
    >
      <span aria-hidden className="inline-flex items-center justify-center shrink-0 w-5 h-5 text-[var(--fg-3)]">
        {topic.ticker ? (
          <CoinIcon symbol={topic.ticker} size={16} />
        ) : topic.icon ? (
          <TopicIcon kind={topic.icon} size={14} />
        ) : (
          <TopicIcon kind="spark" size={14} />
        )}
      </span>
      <span className="flex-1 truncate">{topic.label}</span>
      <span
        aria-hidden
        className="shrink-0 inline-flex items-center justify-center h-5 w-5 text-[var(--fg-3)] opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <svg width={11} height={11} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 6a4 4 0 1 0 1.2-2.85" />
          <path d="M2 1.5v2.5h2.5" />
        </svg>
      </span>
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
            text-up transition. Inline icons inject in front of any
            coin name in the rolling prompt (Bitcoin, Solana, …) so the
            suggested question carries its market context inline. */}
        <span
          key={current}
          className="vz-example-roll inline-block text-balance"
        >
          {renderTextWithInlineCoinIcons(current, { iconSize: 14 })}
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

/**
 * v0.5.1 — modal that mounts only when a chat-delete tripped the
 * active-workflow guard. Shares the same minimalist dialog
 * vocabulary as the CapabilityActionModal (rounded-xl, hairline
 * border, monospace uppercase CTAs) so the two consent surfaces
 * feel like one system. Not extracted into its own file because the
 * shell is the only caller and inlining keeps the state ref close
 * to the pendingDelete state above.
 */
function DeleteWorkflowsGuard({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: { id: string; count: number; kinds: string[] } | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('predict.workflows.deleteGuard');
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, onCancel]);
  if (!pending) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        'fixed inset-0 z-[80] flex items-center justify-center p-4',
        'bg-[color-mix(in_oklab,var(--bg)_60%,transparent)]',
        'backdrop-blur-[3px]',
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className={cn(
          'vz-intent-pop',
          'w-full max-w-sm rounded-xl',
          'border border-[var(--border)]',
          'bg-[var(--surface)]',
        )}
      >
        <div className="px-4 pt-4 pb-2">
          <h2 className="text-[12.5px] font-semibold text-[var(--fg)] leading-none">
            {t('title')}
          </h2>
        </div>
        <div className="px-4 pt-1 pb-4">
          <p className="text-[11.5px] leading-relaxed text-[var(--fg-2)]">
            {t('body', { count: pending.count })}
          </p>
          <div className="mt-4 flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={onCancel}
              className={cn(
                'inline-flex items-center justify-center h-7 px-2',
                'text-[10.5px] mono tabular uppercase tracking-[0.16em]',
                'text-[var(--fg-3)] hover:text-[var(--fg)] bg-transparent',
                'transition-colors duration-150',
              )}
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={cn(
                'inline-flex items-center justify-center rounded-md h-7 px-3',
                'text-[10.5px] font-semibold mono tabular uppercase tracking-[0.16em]',
                'bg-[var(--down)] text-[var(--bg)]',
                'hover:opacity-90 active:scale-95',
                'transition-[opacity,transform] duration-150',
              )}
            >
              {t('confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
