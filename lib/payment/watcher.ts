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
import { listPendingSessions } from './db';
import { paymentNetwork } from './network';
import { finalizeSession } from './session';
import { solanaTreasury } from './treasury';

const POLL_INTERVAL_MS = 5_000;
const SLIPPAGE_TOLERANCE = 0.005; // ±0.5%
const LAMPORTS_PER_SOL = 1_000_000_000;

const KEY = Symbol.for('vizzor.payment.watcher');
interface GlobalWithWatcher {
  [KEY]?: {
    started: boolean;
    lastSlot: number | null;
  };
}
const g = globalThis as unknown as GlobalWithWatcher;

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
  const state = (g[KEY] = g[KEY] ?? { started: false, lastSlot: null });
  if (state.started) return;
  state.started = true;
  void tick(state);
}

function solanaRpc(): string {
  return solanaRpcUrl();
}

async function tick(state: { lastSlot: number | null }): Promise<void> {
  try {
    await pollOnce(state);
  } catch (e) {
    // Swallow — watcher must keep running. Log to stderr for ops.
    // eslint-disable-next-line no-console
    console.error('[vizzor-watcher] tick failed:', e);
  } finally {
    setTimeout(() => tick(state), POLL_INTERVAL_MS);
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

    const tx = await connection.getParsedTransaction(sig.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    if (!tx || tx.meta?.err) continue;

    const memo = extractMemo(tx);
    if (!memo) continue;

    const session = pending.find((s) => s.session_id === memo);
    if (!session) continue;

    const transfer = extractNativeTransfer(tx, treasury);
    if (!transfer) continue;

    if (!amountMatches(transfer.amount, session.amount)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[vizzor-watcher] amount mismatch on ${memo}: paid ${transfer.amount} SOL, expected ${session.amount}`,
      );
      continue;
    }

    // Confirm + create subscription + mint grant + back-fill TG id
    // atomically via the shared finalizeSession helper.
    const result = finalizeSession(session, sig.signature, transfer.payer);
    if (result.confirmed) {
      // eslint-disable-next-line no-console
      console.info(
        `[vizzor-watcher] confirmed ${session.session_id} · ${session.tier}/${session.cadence} · payer=${transfer.payer || 'unknown'}${result.walletLinkedTo ? ` · tg=${result.walletLinkedTo}` : ''}`,
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
