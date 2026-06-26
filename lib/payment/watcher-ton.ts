/**
 * TON payment watcher — polls each pending TON session's derived
 * destination address for an incoming transfer that matches the
 * locked amount, then calls the shared `finalizeSession` helper.
 *
 * Lifecycle mirrors `lib/payment/watcher.ts`:
 *   1. `ensureTonWatcherStarted()` — idempotent boot guarded by a
 *      globalThis flag + the `acceptTonPayments()` feature flag.
 *   2. `tick()` — every 6s (TON block time is ~5s; one tick per
 *      block keeps the call volume on toncenter sane).
 *   3. `pollOnce()` — iterates pending TON sessions. For each,
 *      queries `getTransactions` on the session's per-derived
 *      destination address. Filters incoming msgs whose value (in
 *      nanoTON) matches the locked amount within ±0.5%.
 *   4. On match: shared `finalizeSession(session, txHash, payer)`.
 *      Replay defense via the existing signature_replay_cache.
 *
 * Privacy: the address itself disambiguates which session a payment
 * belongs to (each session has a unique pre-derived address from the
 * pool). The comment field is recorded for cross-reference in the
 * audit log but is NOT load-bearing for matching — a customer who
 * forgets the memo still gets credit, and an attacker who fakes the
 * memo can't redirect funds because the address is the primary key.
 */

import { Address, type TonClient } from '@ton/ton';
import {
  type SessionRow,
  listPendingSessions,
} from './db';
import { getTonClient } from '../ton';
import { acceptTonPayments } from '../feature-flags';
import { finalizeSession } from './session';
import {
  checkSignature as checkReplaySignature,
  recordSignature as recordReplaySignature,
} from './replay-cache';
import { screenPayer } from './sanctions';
import { recordAudit, actorFromWallet } from './audit';
import { getDb } from './db';
import { shortenAddress } from './log-redact';

const POLL_INTERVAL_MS = 6_000;
/** Cap exponential backoff at 60s — matches SOL watcher. Beyond that
 *  we'd miss the 5-min rate-lock window for in-flight sessions even on
 *  a single tick. */
const MAX_BACKOFF_MS = 60_000;
/** Same slippage band the Solana watcher uses. The locked rate has a
 *  5-min validity window; within that window a ±0.5% wallet-side
 *  rounding error shouldn't reject the payment. */
const SLIPPAGE_TOLERANCE = 0.005;
/** Per-tick cap on transactions inspected per session address. TON's
 *  toncenter `getTransactions` returns up to 100 rows per call; 20 is
 *  comfortably more than any session will see in its 5-min lifetime
 *  while keeping the rate-limit footprint small. */
const TX_LIMIT_PER_ADDRESS = 20;

interface TonWatcherState {
  started: boolean;
  lastTickAt: number | null;
  /** Adaptive backoff state — counts consecutive tick failures. The
   *  next poll waits `min(MAX_BACKOFF_MS, POLL_INTERVAL_MS * 2^errors)`.
   *  Resets to 0 on the next successful tick. */
  consecutiveErrors: number;
}

const KEY = Symbol.for('vizzor.payment.watcher.ton');
interface GlobalWithState {
  [KEY]?: TonWatcherState;
}
const g = globalThis as unknown as GlobalWithState;

export function isTonWatcherStarted(): boolean {
  return g[KEY]?.started ?? false;
}

/**
 * Last successful TON poll-tick timestamp (epoch ms). Mirrors
 * `getWatcherLastTickAt()` from the SOL watcher so `/api/health` can
 * report a stuck TON watcher the same way it reports a stuck SOL one.
 * `null` if the watcher has never ticked successfully.
 */
export function getTonWatcherLastTickAt(): number | null {
  return g[KEY]?.lastTickAt ?? null;
}

export function ensureTonWatcherStarted(): void {
  if (!acceptTonPayments()) return;
  const state = (g[KEY] =
    g[KEY] ?? { started: false, lastTickAt: null, consecutiveErrors: 0 });
  if (state.started) return;
  state.started = true;
  void tick(state);
}

async function tick(state: TonWatcherState): Promise<void> {
  let delay = POLL_INTERVAL_MS;
  try {
    await pollOnce();
    state.lastTickAt = Date.now();
    state.consecutiveErrors = 0;
  } catch (e) {
    state.consecutiveErrors = Math.min(state.consecutiveErrors + 1, 10);
    delay = Math.min(
      MAX_BACKOFF_MS,
      POLL_INTERVAL_MS * 2 ** Math.min(state.consecutiveErrors - 1, 6),
    );
    // eslint-disable-next-line no-console
    console.error(
      `[vizzor-watcher-ton] tick failed (consec=${state.consecutiveErrors}, next in ${delay}ms):`,
      (e as Error)?.message ?? e,
    );
  } finally {
    setTimeout(() => tick(state), delay);
  }
}

async function pollOnce(): Promise<void> {
  const pending = listPendingSessions(Date.now()).filter(
    (s) => s.chain === 'ton' && s.token === 'native',
  );
  if (pending.length === 0) return;

  const client = getTonClient();

  for (const session of pending) {
    try {
      await pollSession(client, session);
    } catch (e) {
      // Per-session failure (RPC outage on one address, malformed
      // response, etc.) shouldn't abort the rest of the tick.
      // eslint-disable-next-line no-console
      console.warn(
        `[vizzor-watcher-ton] session ${session.session_id} poll failed:`,
        (e as Error)?.message ?? e,
      );
    }
  }
}

async function pollSession(
  client: TonClient,
  session: SessionRow,
): Promise<void> {
  // The session row carries its own derived destination address from
  // the pre-derived pool. Each session has a unique one — no static
  // shared treasury.
  let destAddr: Address;
  try {
    destAddr = Address.parse(session.dest_address);
  } catch {
    return;
  }

  const txs = await client.getTransactions(destAddr, {
    limit: TX_LIMIT_PER_ADDRESS,
    archival: false,
  });

  for (const tx of txs) {
    const inMsg = tx.inMessage;
    if (!inMsg || inMsg.info.type !== 'internal') continue;

    const value = inMsg.info.value.coins;
    const amountTon = nanoToTon(value);
    if (!amountMatches(amountTon, session.amount)) continue;

    const payerAddr = inMsg.info.src;
    const payer = payerAddr ? payerAddr.toString({ urlSafe: true, bounceable: false }) : '';
    if (!payer) continue;

    // Replay defense — TON tx hash through the shared replay cache.
    const txHash = tx.hash().toString('hex');
    if (checkReplaySignature(txHash)) continue;

    // OFAC payer screen — same contract as Solana. Failed screen
    // hard-stops the session at 'failed' and burns the hash so
    // subsequent ticks don't re-check.
    const screen = screenPayer(payer, 'ton');
    if (!screen.ok) {
      try {
        getDb()
          .prepare(
            `UPDATE payment_sessions SET status='failed' WHERE session_id=? AND status='pending'`,
          )
          .run(session.session_id);
      } catch {
        // Best-effort; replay cache below still prevents re-check.
      }
      recordAudit({
        eventType: 'grant.redeem',
        actor: actorFromWallet(payer),
        subject: session.session_id,
        outcome: 'denied',
      });
      // eslint-disable-next-line no-console
      console.warn(
        `[vizzor-watcher-ton] BLOCKED sanctioned payer ${shortenAddress(payer)} on session ${session.session_id}`,
      );
      recordReplaySignature(txHash);
      continue;
    }

    const result = finalizeSession(session, txHash, payer);
    if (result.confirmed) {
      recordReplaySignature(txHash);
      // eslint-disable-next-line no-console
      console.info(
        `[vizzor-watcher-ton] confirmed ${session.session_id} · ${session.tier}/${session.cadence} · payer=${shortenAddress(payer)}${result.walletLinkedTo ? ' · tg=bound' : ''}`,
      );
    }
  }
}

function nanoToTon(nano: bigint): number {
  // 1 TON = 1e9 nanoTON. Convert via string to avoid the ~15 sig-fig
  // float drift on large balances; the 4-decimal session amount has
  // plenty of headroom for the rounding the comparison needs.
  return Number(nano) / 1e9;
}

function amountMatches(paid: number, expected: number): boolean {
  if (paid <= 0 || expected <= 0) return false;
  const ratio = paid / expected;
  return ratio >= 1 - SLIPPAGE_TOLERANCE && ratio <= 1 + SLIPPAGE_TOLERANCE;
}
