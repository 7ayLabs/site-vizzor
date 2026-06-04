/**
 * On-chain payment watcher — boots once per Node process, polls each
 * supported chain for incoming transfers that match pending sessions,
 * marks them confirmed, and creates the wallet-bound subscription row.
 *
 * Phase 1 chains:
 *   - Solana (for $VIZZOR-pay)
 *
 * TON watching needs a separate client (tonweb / @ton/ton) and is
 * deferred — the architecture is identical (poll, parse, match,
 * confirm) and can drop in later.
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
import { acceptVizzorPayments } from '@/lib/feature-flags';
import {
  insertSubscription,
  listPendingSessions,
  markSessionConfirmed,
  type SessionRow,
} from './db';
import { solanaTreasury } from './treasury';

const POLL_INTERVAL_MS = 5_000;
const SLIPPAGE_TOLERANCE = 0.005; // ±0.5%

const KEY = Symbol.for('vizzor.payment.watcher');
interface GlobalWithWatcher {
  [KEY]?: {
    started: boolean;
    lastSlot: number | null;
  };
}
const g = globalThis as unknown as GlobalWithWatcher;

export function ensureWatcherStarted(): void {
  if (!acceptVizzorPayments()) return;
  const state = (g[KEY] = g[KEY] ?? { started: false, lastSlot: null });
  if (state.started) return;
  state.started = true;
  // Fire-and-forget loop; tick() schedules its own next run.
  void tick(state);
}

function solanaRpc(): string {
  return (
    process.env.SOLANA_RPC_URL ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    'https://api.mainnet-beta.solana.com'
  );
}

function vizzorMint(): string | null {
  return process.env.NEXT_PUBLIC_VIZZOR_MINT ?? null;
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
    (s) => s.chain === 'solana' && s.token === 'vizzor',
  );
  if (pending.length === 0) return;

  const mint = vizzorMint();
  if (!mint) return; // can't verify without the mint

  const treasury = solanaTreasury();
  let treasuryPk: PublicKey;
  let mintPk: PublicKey;
  try {
    treasuryPk = new PublicKey(treasury);
    mintPk = new PublicKey(mint);
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

    const transfer = extractSplTransfer(tx, treasury, mint);
    if (!transfer) continue;

    if (!amountMatches(transfer.amount, session.amount, session.decimals)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[vizzor-watcher] amount mismatch on ${memo}: paid ${transfer.amount}, expected ${session.amount}`,
      );
      continue;
    }

    // Confirm + create subscription atomically.
    finalizeSession(session, sig.signature, transfer.payer);
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
    const programId =
      'programId' in ix ? ix.programId.toBase58() : null;
    if (programId !== memoProgram) continue;
    // Parsed memo instructions surface their text in `parsed`.
    if ('parsed' in ix && typeof ix.parsed === 'string') {
      return ix.parsed.trim();
    }
  }
  return null;
}

interface TransferDetails {
  /** Human-units amount paid. */
  amount: number;
  /** Source wallet (payer) base58 address. */
  payer: string;
}

function extractSplTransfer(
  tx: Awaited<ReturnType<Connection['getParsedTransaction']>>,
  treasuryOwner: string,
  expectedMint: string,
): TransferDetails | null {
  if (!tx) return null;
  const post = tx.meta?.postTokenBalances ?? [];
  const pre = tx.meta?.preTokenBalances ?? [];

  for (const p of post) {
    if (String(p.mint) !== expectedMint) continue;
    if (String(p.owner ?? '') !== treasuryOwner) continue;
    const preEntry = pre.find(
      (x) => x.accountIndex === p.accountIndex && x.mint === expectedMint,
    );
    const preAmt = preEntry?.uiTokenAmount.uiAmount ?? 0;
    const postAmt = p.uiTokenAmount.uiAmount ?? 0;
    const delta = postAmt - preAmt;
    if (delta <= 0) continue;

    // The payer is the wallet whose token balance decreased for the
    // same mint. Useful for binding the subscription to a wallet.
    let payer = '';
    for (const candidate of pre) {
      if (String(candidate.mint) !== expectedMint) continue;
      if (String(candidate.owner ?? '') === treasuryOwner) continue;
      const postCand = post.find(
        (x) => x.accountIndex === candidate.accountIndex,
      );
      const dropped =
        (candidate.uiTokenAmount.uiAmount ?? 0) -
        (postCand?.uiTokenAmount.uiAmount ?? 0);
      if (dropped >= delta * 0.99) {
        payer = String(candidate.owner ?? '');
        break;
      }
    }
    return { amount: delta, payer };
  }
  return null;
}

function amountMatches(paid: number, expected: number, _decimals: number): boolean {
  if (paid <= 0 || expected <= 0) return false;
  const ratio = paid / expected;
  return ratio >= 1 - SLIPPAGE_TOLERANCE && ratio <= 1 + SLIPPAGE_TOLERANCE;
}

function cadenceExpiry(cadence: string): number | null {
  const now = Date.now();
  switch (cadence) {
    case 'monthly':
      return now + 30 * 24 * 60 * 60 * 1000;
    case 'annual':
      return now + 365 * 24 * 60 * 60 * 1000;
    case 'lifetime':
      return null;
    default:
      return now + 30 * 24 * 60 * 60 * 1000;
  }
}

function finalizeSession(
  session: SessionRow,
  txSig: string,
  payer: string,
): void {
  markSessionConfirmed(session.session_id, txSig, payer, Date.now());

  // Create the wallet-bound subscription. The payer wallet address is
  // what /predict will look up via the SIWS auth cookie.
  if (payer) {
    insertSubscription({
      wallet_address: payer,
      tier: session.tier,
      cadence: session.cadence,
      expires_at: cadenceExpiry(session.cadence),
      session_id: session.session_id,
    });
  }
  // eslint-disable-next-line no-console
  console.info(
    `[vizzor-watcher] confirmed ${session.session_id} · ${session.tier}/${session.cadence} · payer=${payer || 'unknown'}`,
  );
}
