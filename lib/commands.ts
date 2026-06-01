/**
 * Vizzor slash-command dispatcher for the on-site chat surface.
 *
 * The product has two command surfaces today:
 *   - Telegram bot: 32 commands (user + admin) — see docs/telegram.mdx
 *   - CLI / TUI:    overlapping slash commands + free-text — see docs/cli.mdx
 *
 * The site is a *third* surface that lives on the public marketing
 * domain. It can't host the full Vizzor command set (forensics,
 * agents, scheduler, subscriptions etc. all need the product backend
 * and per-user state). What it CAN host:
 *
 *   - `/predict` and free-text prediction prompts (we already do this)
 *   - Read-only stats from the committed snapshot (`/wr`, `/precisions`,
 *     `/price`, `/trends`)
 *   - `/help` — list what works here, point everything else to Telegram
 *
 * Every other command returns a polite "this lives in the Telegram
 * bot" response with the deep-link, so users typing real commands get
 * a useful answer instead of a phantom prediction.
 *
 * Quota model:
 *   - `predict` intent: counts toward the 3-free quota (it generates
 *     a calibrated prediction — same cost as the engine).
 *   - `stat` / `info` / `redirect` intents: free, no quota burn.
 *
 * The route handler (`app/api/predict/route.ts`) consults `parseIntent`
 * BEFORE the quota gate so info commands work even after exhaustion.
 */

import { getTicker, getTrackerWR } from '@/lib/snapshot';
import { TOP_20 } from '@/lib/coin-meta';
import { formatUsd } from '@/lib/utils';
import { parseUserMessage } from '@/lib/predict-format';

export type IntentKind = 'predict' | 'stat' | 'info' | 'redirect' | 'unknown';

export interface ParsedIntent {
  kind: IntentKind;
  /** When kind === 'predict', the parsed symbol + horizon are attached. */
  predict?: { symbol: string; horizon: string; locale: 'en' | 'es' | 'fr' };
  /** When kind !== 'predict', the rendered text to stream back. */
  text?: string;
  /** Command name for telemetry / logging. */
  command?: string;
}

const TELEGRAM_DEEP_LINK = 'https://t.me/vizzorai_bot';

/**
 * Dispatch a user message into an intent. The route handler decides
 * whether to apply the quota gate and how to stream the response.
 */
export function parseIntent(rawText: string): ParsedIntent {
  const text = rawText.trim();
  if (text.length === 0) {
    return { kind: 'unknown' };
  }

  // Free-text → prediction (existing behavior).
  if (!text.startsWith('/')) {
    return {
      kind: 'predict',
      predict: parseUserMessage(text),
    };
  }

  // Slash command — first word is the command, rest are args.
  const [head, ...rest] = text.split(/\s+/);
  const cmd = head!.toLowerCase();
  const args = rest;

  switch (cmd) {
    case '/help':
    case '/start':
      return { kind: 'info', command: cmd, text: renderHelp() };

    case '/predict': {
      // `/predict BTC 4h` — pass the rest as a normal prediction prompt
      // so the existing parser handles symbol + horizon detection.
      const passthrough = args.join(' ');
      const parsed = parseUserMessage(passthrough);
      return { kind: 'predict', command: cmd, predict: parsed };
    }

    case '/wr':
    case '/winrate':
      return { kind: 'stat', command: cmd, text: renderWr() };

    case '/precisions':
    case '/precision':
      return { kind: 'stat', command: cmd, text: renderPrecisions() };

    case '/price':
    case '/prices': {
      const symbol = args[0]?.toUpperCase() ?? null;
      return { kind: 'stat', command: cmd, text: renderPrice(symbol) };
    }

    case '/trends':
    case '/trending':
      return { kind: 'stat', command: cmd, text: renderTrends() };

    // Bot-only commands — surface the deep link.
    case '/scheduler':
    case '/chronovisor':
    case '/diagnose':
    case '/pending':
    case '/mode':
    case '/signaloverride':
    case '/health':
    case '/debug':
    case '/reset':
    case '/backtest':
    case '/allow':
    case '/deny':
    case '/access':
      return { kind: 'redirect', command: cmd, text: renderAdminRedirect(cmd) };

    case '/predictions':
    case '/sub':
    case '/unsub':
    case '/watchlist':
    case '/alerts':
    case '/alert':
    case '/mute':
    case '/quiet':
    case '/tz':
    case '/notify_threshold':
    case '/me':
    case '/whoami':
    case '/settings':
    case '/playbook':
    case '/leaderboard':
    case '/scan':
    case '/audit':
    case '/track':
    case '/ico':
    case '/polymarket':
      return { kind: 'redirect', command: cmd, text: renderUserRedirect(cmd) };

    // /agent <subcommand> — CLI-only surface
    case '/agent':
    case '/agents':
      return { kind: 'redirect', command: cmd, text: renderCliOnly(cmd) };

    case '/chain':
    case '/provider':
    case '/config':
    case '/add':
    case '/remove':
      return { kind: 'redirect', command: cmd, text: renderCliOnly(cmd) };

    default:
      return { kind: 'unknown', command: cmd, text: renderUnknown(cmd) };
  }
}

/* ------------------------------------------------------------------ *\
 * Renderers — every command writes to the same Helios-mono receipt
 * style used by the prediction format.
 * ------------------------------------------------------------------ */

function renderHelp(): string {
  return `vizzor · on-site command surface

available here
  /help                       this list
  /predict <SYM> <HORIZON>    request a prediction (also free-text)
  /wr                         tracked aggregate win-rate
  /precisions                 full WR breakdown by horizon + tier
  /price <SYM>                current price for a tracked symbol
  /trends                     top movers in the last 24h

bot-only (open ${TELEGRAM_DEEP_LINK})
  /scheduler   /chronovisor   /diagnose   /pending   /mode
  /scan        /track         /audit      /agent     /backtest
  /sub /unsub  /watchlist     /alerts     /alert     /mute /quiet
  /me          /whoami        /settings   /playbook  /leaderboard
  /allow       /deny          /access     /signaloverride
  /tz          /notify_threshold

quota
  free tier   3 predictions per browser · /predict counts, info reads don't
  paid tier   burn $VIZZOR (launching soon) for unlimited`;
}

function renderWr(): string {
  const wr = getTrackerWR();
  const pct = (n: number) => (n * 100).toFixed(1) + '%';
  return `tracked win-rate · v0.15.5 helios

aggregate     ${pct(wr.aggregate.wr)}     n=${wr.aggregate.samples}
asOf          ${wr.aggregate.asOf}

by tier
  high-conviction   ${pct(wr.byTier['high-conviction'].wr)}   n=${wr.byTier['high-conviction'].samples}
  whale-confirmed   ${pct(wr.byTier['whale-confirmed'].wr)}   n=${wr.byTier['whale-confirmed'].samples}
  tracked           ${pct(wr.byTier['tracked'].wr)}   n=${wr.byTier['tracked'].samples}
  advisory          ${pct(wr.byTier['advisory'].wr)}   n=${wr.byTier['advisory'].samples}`;
}

function renderPrecisions(): string {
  const wr = getTrackerWR();
  const last24h = (wr as { last24h?: { hits: number; misses: number; neutrals: number; pending: number; decisiveWR: number } }).last24h;
  const pct = (n: number) => (n * 100).toFixed(1) + '%';

  const byHorizonLines = Object.entries(wr.byHorizon)
    .sort(([a], [b]) => compareHorizon(a, b))
    .map(
      ([h, v]) =>
        `  ${padRight(h, 6)} ${pct(v.wr).padStart(7)}   n=${v.samples}`,
    )
    .join('\n');

  return `precisions · global

accuracy
  resolved      ${wr.aggregate.samples}
  decisive WR   ${pct(wr.aggregate.wr)}

by horizon
${byHorizonLines}

by tier
  high-conviction   ${pct(wr.byTier['high-conviction'].wr)}   n=${wr.byTier['high-conviction'].samples}
  whale-confirmed   ${pct(wr.byTier['whale-confirmed'].wr)}   n=${wr.byTier['whale-confirmed'].samples}
  tracked           ${pct(wr.byTier['tracked'].wr)}   n=${wr.byTier['tracked'].samples}
  advisory          ${pct(wr.byTier['advisory'].wr)}   n=${wr.byTier['advisory'].samples}
${
  last24h
    ? `
last 24h
  hits ${last24h.hits} · misses ${last24h.misses} · neutrals ${last24h.neutrals} · pending ${last24h.pending}
  decisive WR ${pct(last24h.decisiveWR)}`
    : ''
}`;
}

function renderPrice(symbolArg: string | null): string {
  if (!symbolArg) {
    return `/price — current price for a tracked symbol

usage:  /price <SYMBOL>
example: /price BTC

tracked: ${TOP_20.map((c) => c.symbol).join(' · ')}`;
  }

  const ticker = getTicker();
  const entry = ticker.find((t) => t.symbol === symbolArg);
  if (!entry) {
    return `/price ${symbolArg} — symbol not tracked.

tracked: ${TOP_20.map((c) => c.symbol).join(' · ')}`;
  }

  const delta = (entry.changePct * 100).toFixed(2) + '%';
  const arrow = entry.changePct >= 0 ? '+' : '';
  return `${entry.symbol}  ${formatUsd(entry.price)}
24h    ${arrow}${delta}
src    ${entry.source ?? 'unknown'}`;
}

function renderTrends(): string {
  const ticker = getTicker();
  const sorted = [...ticker].sort((a, b) => b.changePct - a.changePct);
  const top = sorted.slice(0, 5);
  const bottom = sorted.slice(-5).reverse();
  const line = (e: { symbol: string; price: number; changePct: number }) =>
    `  ${padRight(e.symbol, 5)} ${formatUsd(e.price).padStart(12)}   ${(e.changePct * 100 >= 0 ? '+' : '')}${(e.changePct * 100).toFixed(2)}%`;
  return `trending · last 24h

gainers
${top.map(line).join('\n')}

losers
${bottom.map(line).join('\n')}`;
}

function renderAdminRedirect(cmd: string): string {
  return `${cmd} — admin command (Telegram bot only)

This command operates the engine in real time (scheduler slots, mode
switches, signal overrides, runtime knobs). It requires bot-admin role
and isn't available from the public on-site chat.

open the bot: ${TELEGRAM_DEEP_LINK}`;
}

function renderUserRedirect(cmd: string): string {
  return `${cmd} — Telegram-only command

Subscriptions, alerts, forensics, and user-state commands live in the
Telegram bot where DMs and per-user preferences are stored. The on-site
chat is a stateless demo surface — it can't track watchlists or send
alerts.

open the bot: ${TELEGRAM_DEEP_LINK}`;
}

function renderCliOnly(cmd: string): string {
  return `${cmd} — CLI / TUI command

This command is part of the local Vizzor CLI surface — it requires the
self-hosted engine and config. Install with:

  npm i -g @vizzor/cli
  vizzor

or open the Telegram bot for hosted equivalents: ${TELEGRAM_DEEP_LINK}`;
}

function renderUnknown(cmd: string): string {
  return `${cmd} — unknown command

type /help to see what works on this surface, or open the full bot:
${TELEGRAM_DEEP_LINK}`;
}

/* ------------------------------------------------------------------ *\
 * helpers
 * ------------------------------------------------------------------ */

const HORIZON_ORDER: Record<string, number> = {
  '5m': 1,
  '15m': 2,
  '30m': 3,
  '1h': 4,
  '2h': 5,
  '4h': 6,
  '6h': 7,
  '12h': 8,
  '1d': 9,
  '7d': 10,
  '30d': 11,
  '90d': 12,
  '1y': 13,
};

function compareHorizon(a: string, b: string): number {
  const ra = HORIZON_ORDER[a] ?? 99;
  const rb = HORIZON_ORDER[b] ?? 99;
  return ra - rb;
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}
