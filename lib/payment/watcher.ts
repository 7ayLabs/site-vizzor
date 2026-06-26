/**
 * Solana payment watcher — boots once per Node process, polls Solana
 * for incoming native SOL transfers that match pending sessions,
 * marks them confirmed, and creates the wallet-bound subscription row.
 *
 * v0.2.0 ships Solana-native-only. Each pending session locks a SOL
 * amount + a memo carrying its session_id. The watcher walks recent
 * signatures on the treasury, finds memo'd transfers with matching
 * amounts (±0.5% slippage), and calls finalizeSession().
 *
 * Subscription duration mapping:
 *   monthly  → +30d
 *   annual   → +365d
 *   lifetime → null (never expires)
 *
 * Boot semantics: importing this module from any server route via
 * `ensureWatcherStarted()` is safe — uses a globalThis-stashed flag
 * so HMR doesn't spin up duplicate watchers.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { acceptSolanaPayments } from '@/lib/feature-flags';
import { solanaRpcUrl } from '@/lib/solana';
import { getDb, listPendingSessions } from './db';
import { paymentNetwork } from './network';
import { finalizeSession } from './session';
import { solanaTreasury } from './treasury';
import { checkSignature, recordSignature } from './replay-cache';
import { shortenAddress } from './log-redact';
import { screenPayer } from './sanctions';
import { recordAudit, actorFromWallet } from './audit';

const POLL_INTERVAL_MS = 5_000;
const SLIPPAGE_TOLERANCE = 0.005; // ±0.5%
const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * USD threshold above which we wait for Solana `finalized` commitment
 * instead of `confirmed`. Confirmed is ~400 ms and has a small reorg
 * window; finalized is ~13 s but reorg-proof in practice. Acceptable
 * latency cost for high-value sessions ($100+); negligible for the
 * $19 monthly Pro flow.
 *
 * Override via VIZZOR_FINALIZED_USD_THRESHOLD (raw USD cents).
 */
const FINALIZED_USD_CENTS_DEFAULT = 10_000;
function finalizedUsdCentsThreshold(): number {
  const raw = process.env.VIZZOR_FINALIZED_USD_THRESHOLD;
  if (!raw) return FINALIZED_USD_CENTS_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return FINALIZED_USD_CENTS_DEFAULT;
  return Math.floor(n);
}

/**
 * Resolve commitment level for a given session amount. Lifetime-tier
 * payments ($1,499) are auto-finalized; monthly ($19) stays on the
 * faster `confirmed` path.
 */
export function commitmentForAmount(
  amountUsdCents: number,
): 'confirmed' | 'finalized' {
  return amountUsdCents >= finalizedUsdCentsThreshold()
    ? 'finalized'
    : 'confirmed';
}

const KEY = Symbol.for('vizzor.payment.watcher');
/** Cap exponential backoff at 60s — beyond that we'd miss the 5-min
 *  rate-lock window for in-flight sessions even on a single tick. */
const MAX_BACKOFF_MS = 60_000;
interface WatcherState {
  started: boolean;
  lastSlot: number | null;
  /** Epoch-ms of the most recent successful pollOnce() return. */
  lastTickAt: number | null;
  /** Adaptive backoff state — counts consecutive tick failures. The
   *  next poll waits `min(MAX_BACKOFF_MS, POLL_INTERVAL_MS * 2^errors)`.
   *  Resets to 0 on the next successful tick so a recovered RPC
   *  endpoint is polled at full cadence immediately. */
  consecutiveErrors: number;
}
interface GlobalWithWatcher {
  [KEY]?: WatcherState;
}
const g = globalThis as unknown as GlobalWithWatcher;

/**
 * Last successful poll-tick timestamp (epoch ms). Read by `/api/health`
 * to flag a stuck watcher in the `subsystems.watcher.stale` field.
 * `null` if the watcher has never ticked successfully — either it
 * never booted (no Solana payments accepted) or every tick has failed.
 */
export function getWatcherLastTickAt(): number | null {
  return g[KEY]?.lastTickAt ?? null;
}

/** Whether the watcher has been booted in this Node process. */
export function isWatcherStarted(): boolean {
  return g[KEY]?.started ?? false;
}

export function ensureWatcherStarted(): void {
  if (!acceptSolanaPayments()) return;
  // Fail fast in production mainnet if no dedicated RPC. Testnet is
  // exempt — devnet's public endpoint is operator-acceptable. The
  // mainnet public fallback is rate-limited (100 req per 10s per IP)
  // and unsafe for the 5s-poll watcher under real volume.
  if (
    process.env.NODE_ENV === 'production' &&
    paymentNetwork() === 'mainnet' &&
    !process.env.SOLANA_RPC_URL &&
    !process.env.SOLANA_RPC_URL_MAINNET
  ) {
    throw new Error(
      '[vizzor-watcher] refusing to start: no mainnet Solana RPC configured. ' +
        'The public fallback is rate-limited and unsafe for the 5s-poll watcher. ' +
        'Configure a dedicated provider (Helius, Triton, QuickNode, or equivalent) and set ' +
        'SOLANA_RPC_URL or SOLANA_RPC_URL_MAINNET on the site host. See docs/ops/secrets.md.',
    );
  }
  const state = (g[KEY] =
    g[KEY] ?? { started: false, lastSlot: null, lastTickAt: null, consecutiveErrors: 0 });
  if (state.started) return;
  state.started = true;
  void tick(state);
}

function solanaRpc(): string {
  return solanaRpcUrl();
}

async function tick(state: WatcherState): Promise<void> {
  let delay = POLL_INTERVAL_MS;
  try {
    await pollOnce(state);
    // Successful tick — clear the backoff counter and resume full
    // cadence. /api/health uses this timestamp to flag staleness.
    state.lastTickAt = Date.now();
    state.consecutiveErrors = 0;
  } catch (e) {
    // Adaptive backoff — exponential, capped at MAX_BACKOFF_MS. Without
    // it, a sustained RPC outage retries every 5s and DoSes the
    // provider; with it, we degrade gracefully and resume full cadence
    // the moment the endpoint recovers.
    state.consecutiveErrors = Math.min(state.consecutiveErrors + 1, 10);
    delay = Math.min(
      MAX_BACKOFF_MS,
      POLL_INTERVAL_MS * 2 ** Math.min(state.consecutiveErrors - 1, 6),
    );
    // eslint-disable-next-line no-console
    console.error(
      `[vizzor-watcher] tick failed (consec=${state.consecutiveErrors}, next in ${delay}ms):`,
      (e as Error)?.message ?? e,
    );
  } finally {
    setTimeout(() => tick(state), delay);
  }
}

async function pollOnce(state: { lastSlot: number | null }): Promise<void> {
  const pending = listPendingSessions(Date.now()).filter(
    (s) => s.chain === 'solana' && s.token === 'native',
  );
  if (pending.length === 0) return;

  const treasury = solanaTreasury();
  let treasuryPk: PublicKey;
  try {
    treasuryPk = new PublicKey(treasury);
  } catch {
    return; // invalid config
  }

  const connection = new Connection(solanaRpc(), 'confirmed');

  // Fetch recent signatures for the treasury. Limit 50 keeps the RPC
  // surface tight; the watcher runs every 5s so 50 signatures covers
  // ~250 seconds of activity comfortably.
  const signatures = await connection.getSignaturesForAddress(treasuryPk, {
    limit: 50,
  });

  for (const sig of signatures) {
    if (sig.err) continue;
    if (state.lastSlot !== null && sig.slot <= state.lastSlot) continue;

    // First-pass parse at 'confirmed' commitment — fast, cheap,
    // surfaces the memo so we can decide the right commitment level
    // for the matched session before deciding finalize.
    const tx = await connection.getParsedTransaction(sig.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    if (!tx || tx.meta?.err) continue;

    const memo = extractMemo(tx);
    if (!memo) continue;

    const session = pending.find((s) => s.session_id === memo);
    if (!session) continue;

    // For high-value sessions, re-fetch at 'finalized' so a reorg
    // cannot retroactively reverse the payment. Adds ~13s of latency
    // on a $1,499 lifetime; zero cost on a $19 Pro monthly.
    const requiredCommitment = commitmentForAmount(session.amount_usd_cents);
    if (requiredCommitment === 'finalized') {
      const finalTx = await connection.getParsedTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'finalized',
      });
      if (!finalTx || finalTx.meta?.err) {
        // Not yet finalized — leave for a future tick. The retention
        // sweep eventually expires unmatched sessions; the watcher's
        // outer loop will retry as long as the session is pending.
        continue;
      }
    }

    // Replay defense: a Solana reorg can re-surface the same tx_sig
    // against a different slot's view of the chain. Without this
    // guard we'd re-credit the payment. See lib/payment/replay-cache.ts.
    if (checkSignature(sig.signature)) {
      continue;
    }

    const transfer = extractNativeTransfer(tx, treasury);
    if (!transfer) continue;

    if (!amountMatches(transfer.amount, session.amount)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[vizzor-watcher] amount mismatch on ${memo}: paid ${transfer.amount} SOL, expected ${session.amount}`,
      );
      continue;
    }

    // v0.2.x compliance — OFAC payer screen. A sanctioned payer means
    // we hard-stop the session at 'failed' (operator unblocks manually
    // after refund review) and burn the signature so subsequent ticks
    // skip the same tx. Never finalize and never expose the failure
    // mode to the public API — it lands in `audit_log` only.
    const screen = screenPayer(transfer.payer, 'solana');
    if (!screen.ok) {
      try {
        getDb()
          .prepare(`UPDATE payment_sessions SET status='failed' WHERE session_id=? AND status='pending'`)
          .run(session.session_id);
      } catch {
        // Best effort — even if the DB update fails, recording the
        // signature below prevents re-finalization on the next tick.
      }
      recordAudit({
        eventType: 'grant.redeem', // closest existing event type; OFAC
        // events get their own type when v0.3.x extends the AuditEventType
        // union. For now we co-opt this with a clear outcome value below.
        actor: actorFromWallet(transfer.payer),
        subject: session.session_id,
        outcome: 'denied',
      });
      // eslint-disable-next-line no-console
      console.warn(
        `[vizzor-watcher] BLOCKED sanctioned payer ${shortenAddress(transfer.payer)} on session ${session.session_id}`,
      );
      recordSignature(sig.signature);
      continue;
    }

    // Confirm + create subscription + mint grant + back-fill TG id
    // atomically via the shared finalizeSession helper.
    const result = finalizeSession(session, sig.signature, transfer.payer);
    if (result.confirmed) {
      // Record signature AFTER successful finalize so a finalize-side
      // crash doesn't suppress the retry on the next tick.
      recordSignature(sig.signature);
      // eslint-disable-next-line no-console
      console.info(
        // Payer wallet is redacted to first-4 / last-4 — full address
        // would land in container logs / log aggregators, which is a
        // GDPR-controllable PII flow we don't accept. See log-redact.ts.
        `[vizzor-watcher] confirmed ${session.session_id} · ${session.tier}/${session.cadence} · payer=${shortenAddress(transfer.payer)}${result.walletLinkedTo ? ' · tg=bound' : ''}`,
      );
    }
  }

  // Track the highest slot we've seen to short-circuit future polls.
  if (signatures.length > 0) {
    const maxSlot = Math.max(...signatures.map((s) => s.slot));
    state.lastSlot = Math.max(state.lastSlot ?? 0, maxSlot);
  }
}

function extractMemo(
  tx: Awaited<ReturnType<Connection['getParsedTransaction']>>,
): string | null {
  if (!tx) return null;
  const memoProgram = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
  const top = tx.transaction.message.instructions ?? [];
  const inner = (tx.meta?.innerInstructions ?? []).flatMap(
    (g) => g.instructions,
  );
  for (const ix of [...top, ...inner]) {
    const programId = 'programId' in ix ? ix.programId.toBase58() : null;
    if (programId !== memoProgram) continue;
    if ('parsed' in ix && typeof ix.parsed === 'string') {
      return ix.parsed.trim();
    }
  }
  return null;
}

interface TransferDetails {
  /** Human-units (SOL) amount paid. */
  amount: number;
  /** Source wallet (payer) base58 address. */
  payer: string;
}

/**
 * Native-SOL transfer detection.
 *
 * We diff pre/postBalances of the treasury account and find the payer
 * as the account whose lamport balance dropped by approximately the
 * same amount. This avoids parsing System Program instructions one by
 * one and is robust to nonce/fee-payer arrangements.
 */
function extractNativeTransfer(
  tx: Awaited<ReturnType<Connection['getParsedTransaction']>>,
  treasuryOwner: string,
): TransferDetails | null {
  if (!tx) return null;
  const pre = tx.meta?.preBalances ?? [];
  const post = tx.meta?.postBalances ?? [];
  const keys = tx.transaction.message.accountKeys ?? [];

  const treasuryIdx = keys.findIndex(
    (k) => ('pubkey' in k ? k.pubkey.toBase58() : '') === treasuryOwner,
  );
  if (treasuryIdx < 0) return null;

  const delta = (post[treasuryIdx] ?? 0) - (pre[treasuryIdx] ?? 0);
  if (delta <= 0) return null;

  const amountSol = delta / LAMPORTS_PER_SOL;

  // Find the payer: the account whose lamport balance dropped by at
  // least `delta` (accounting for tx fees) and that is NOT the treasury.
  let payer = '';
  for (let i = 0; i < keys.length; i++) {
    if (i === treasuryIdx) continue;
    const dropped = (pre[i] ?? 0) - (post[i] ?? 0);
    if (dropped >= delta * 0.99) {
      const k = keys[i];
      if (k && 'pubkey' in k) {
        payer = k.pubkey.toBase58();
      }
      break;
    }
  }
  return { amount: amountSol, payer };
}

function amountMatches(paid: number, expected: number): boolean {
  if (paid <= 0 || expected <= 0) return false;
  const ratio = paid / expected;
  return ratio >= 1 - SLIPPAGE_TOLERANCE && ratio <= 1 + SLIPPAGE_TOLERANCE;
}
