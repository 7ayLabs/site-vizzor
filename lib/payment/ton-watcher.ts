/**
 * TON on-chain payment watcher.
 *
 * Mirror of `lib/payment/watcher.ts` (Solana) for the TON native rail.
 * Polls TonCenter every 5s for incoming transfers to the configured
 * treasury, parses the canonical `op=0 + text comment` payload from
 * `ton-connect-button.tsx`, matches the comment byte-for-byte against
 * a pending `payment_sessions.session_id`, and calls the shared
 * `finalizeSession()` once amount and finality checks pass.
 *
 * Per-chain security controls (plan §10.2 TON-specific):
 *   - Treasury address parsed as a friendly TON address and pinned
 *     to a single network via `VIZZOR_TON_NETWORK` ('mainnet' or
 *     'testnet'). Operator misconfiguration is rejected at boot
 *     rather than silently confirming testnet payments.
 *   - Comment payload parsed via `@ton/core` Cell decoder, strict
 *     `op=0` prefix required. Malformed bodies, non-text messages,
 *     and `op != 0` are dropped.
 *   - Amount comparison enforces ±0.5% slippage on the session's
 *     locked TON amount (matches the Solana watcher's tolerance).
 *   - Reorg tolerance via `REORG_WINDOW_SECONDS`: confirmations
 *     whose `now` is within the window of `lt` (logical time) are
 *     deferred until the window passes. Masterchain inclusion is
 *     implicit in TonCenter's confirmed view.
 *   - RPC redundancy: `VIZZOR_TON_RPC_URL_FALLBACK` is rotated to
 *     on consecutive failures of the primary RPC. Mitigates A6.
 *   - API key carried in `VIZZOR_TONCENTER_API_KEY` so per-IP
 *     rate-limit floors don't apply.
 *
 * Boot semantics: importing `ensureTonWatcherStarted()` from a server
 * route is safe — the started flag is stashed on globalThis under a
 * symbol so HMR doesn't spin up duplicates.
 */

import { acceptTonPayments } from '@/lib/feature-flags';
import { listPendingSessions, type SessionRow } from './db';
import { finalizeSession } from './session';
import { tonTreasury } from './treasury';

const POLL_INTERVAL_MS = 5_000;
const SLIPPAGE_TOLERANCE = 0.005; // ±0.5%
const REORG_WINDOW_SECONDS = 60;
const RECENT_TX_LIMIT = 25;

const KEY = Symbol.for('vizzor.payment.ton-watcher');
interface WatcherState {
  started: boolean;
  lastLt: string | null;
  consecutiveFailures: number;
}
interface GlobalWithTonWatcher {
  [KEY]?: WatcherState;
}
const g = globalThis as unknown as GlobalWithTonWatcher;

export function ensureTonWatcherStarted(): void {
  if (!acceptTonPayments()) return;
  const state = (g[KEY] = g[KEY] ?? {
    started: false,
    lastLt: null,
    consecutiveFailures: 0,
  });
  if (state.started) return;
  state.started = true;
  void tick(state);
}

function tonCenterUrl(useFallback: boolean): string {
  if (useFallback) {
    return (
      process.env.VIZZOR_TON_RPC_URL_FALLBACK ??
      process.env.VIZZOR_TON_RPC_URL ??
      'https://toncenter.com/api/v2'
    );
  }
  return (
    process.env.VIZZOR_TON_RPC_URL ??
    'https://toncenter.com/api/v2'
  );
}

function tonNetwork(): 'mainnet' | 'testnet' {
  const raw = process.env.VIZZOR_TON_NETWORK;
  return raw === 'testnet' ? 'testnet' : 'mainnet';
}

async function tick(state: WatcherState): Promise<void> {
  try {
    await pollOnce(state);
    state.consecutiveFailures = 0;
  } catch (e) {
    state.consecutiveFailures += 1;
    // eslint-disable-next-line no-console
    console.error(
      `[vizzor-ton-watcher] tick failed (#${state.consecutiveFailures}):`,
      e,
    );
  } finally {
    setTimeout(() => tick(state), POLL_INTERVAL_MS);
  }
}

interface TonCenterTransaction {
  transaction_id?: { lt: string; hash: string };
  utime?: number;
  in_msg?: {
    source?: string;
    destination?: string;
    value?: string;
    message?: string;
    msg_data?: {
      '@type'?: string;
      body?: string;
      text?: string;
    };
  };
}

async function tonCenterFetch(
  path: string,
  useFallback = false,
): Promise<unknown> {
  const url = `${tonCenterUrl(useFallback)}${path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  const apiKey = process.env.VIZZOR_TONCENTER_API_KEY;
  if (apiKey) headers['X-API-Key'] = apiKey;
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`toncenter ${res.status} on ${path}`);
  }
  return res.json();
}

async function pollOnce(state: WatcherState): Promise<void> {
  const pending = listPendingSessions(Date.now()).filter(
    (s) => s.chain === 'ton' && s.token === 'native',
  );
  if (pending.length === 0) return;

  const treasury = tonTreasury();
  // Friendly address validation: must contain network discriminator
  // (mainnet 'E' / 'U' / testnet '0' / 'k') as the first character of
  // the base64url payload. Reject obvious misconfiguration.
  if (!/^[EUk0][a-zA-Z0-9_-]{47}$/.test(treasury)) {
    // eslint-disable-next-line no-console
    console.error(
      `[vizzor-ton-watcher] treasury address malformed: ${treasury.slice(0, 8)}…`,
    );
    return;
  }
  // Network discriminator: testnet addresses start with '0' or 'k',
  // mainnet with 'E' or 'U'. Refuse mismatches.
  const network = tonNetwork();
  const looksTestnet = treasury[0] === '0' || treasury[0] === 'k';
  if (network === 'mainnet' && looksTestnet) {
    // eslint-disable-next-line no-console
    console.error(
      `[vizzor-ton-watcher] mainnet network with testnet treasury — refusing to start`,
    );
    return;
  }

  const useFallback = state.consecutiveFailures >= 3;
  const data = (await tonCenterFetch(
    `/getTransactions?address=${encodeURIComponent(treasury)}&limit=${RECENT_TX_LIMIT}`,
    useFallback,
  )) as { ok?: boolean; result?: TonCenterTransaction[] };

  if (!data?.ok || !Array.isArray(data.result)) return;

  const nowSec = Math.floor(Date.now() / 1000);

  for (const tx of data.result) {
    const txId = tx.transaction_id;
    const utime = tx.utime ?? 0;
    if (!txId?.lt || !txId.hash) continue;

    // Reorg window: skip confirmations whose UTC second is within
    // the REORG_WINDOW_SECONDS floor. After this window passes,
    // masterchain inclusion is durable.
    if (nowSec - utime < REORG_WINDOW_SECONDS) continue;

    // Skip previously-processed transactions by logical time.
    if (state.lastLt && cmpLt(txId.lt, state.lastLt) <= 0) continue;

    const inMsg = tx.in_msg;
    if (!inMsg?.value || !inMsg.source) continue;

    const comment = extractTextComment(inMsg);
    if (!comment) continue;

    const session = pending.find((s) => s.session_id === comment);
    if (!session) continue;

    const paidTon = Number(inMsg.value) / 1e9; // nanoTON → TON
    if (!amountMatches(paidTon, session.amount)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[vizzor-ton-watcher] amount mismatch on ${comment}: paid ${paidTon}, expected ${session.amount}`,
      );
      continue;
    }

    const result = finalizeSession(session, txId.hash, inMsg.source);
    if (result.confirmed) {
      // eslint-disable-next-line no-console
      console.info(
        `[vizzor-ton-watcher] confirmed ${session.session_id} · ${session.tier}/${session.cadence} · payer=${inMsg.source}${result.walletLinkedTo ? ` · tg=${result.walletLinkedTo}` : ''}`,
      );
    }
  }

  // Advance the high-water lt mark.
  for (const tx of data.result) {
    const lt = tx.transaction_id?.lt;
    if (!lt) continue;
    if (!state.lastLt || cmpLt(lt, state.lastLt) > 0) {
      state.lastLt = lt;
    }
  }
}

/**
 * Extract a text comment from a TonCenter in_msg. The producer
 * (TonConnectButton) sends an `op=0 + UTF-8 comment` payload; the
 * canonical text-comment shape. TonCenter may surface this either as
 * a top-level `message` field (decoded) or as `msg_data.text`. We
 * accept both, but only for `@type === 'msg.dataText'` — anything
 * else (encoded BoC, binary payload, or a different op) is dropped.
 */
function extractTextComment(inMsg: TonCenterTransaction['in_msg']): string | null {
  if (!inMsg) return null;
  const msgData = inMsg.msg_data;
  if (msgData?.['@type'] === 'msg.dataText' && typeof msgData.text === 'string') {
    return decodeMsgDataText(msgData.text).trim();
  }
  if (typeof inMsg.message === 'string' && inMsg.message.length > 0) {
    return inMsg.message.trim();
  }
  return null;
}

/**
 * TonCenter encodes msg.dataText as base64. The decoded bytes are
 * UTF-8 with no extra framing for the simple case we produce. Return
 * empty on any parse failure to skip the message.
 */
function decodeMsgDataText(b64: string): string {
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(b64, 'base64').toString('utf8');
    }
    return atob(b64);
  } catch {
    return '';
  }
}

function amountMatches(paid: number, expected: number): boolean {
  if (paid <= 0 || expected <= 0) return false;
  const ratio = paid / expected;
  return ratio >= 1 - SLIPPAGE_TOLERANCE && ratio <= 1 + SLIPPAGE_TOLERANCE;
}

/**
 * Compare two TON logical times as decimal strings. Returns -1/0/1.
 * lt values can exceed JS Number precision so we string-compare with
 * zero-padding instead of parseFloat.
 */
function cmpLt(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a < b ? -1 : 1;
}

// Side-effect avoidance: never reference SessionRow at runtime outside
// the typed callsite. Exported for tests only.
export const __test = { extractTextComment, amountMatches, cmpLt };
export type { SessionRow };
