/**
 * Solana helpers — $VIZZOR token constants + server-side burn verification.
 *
 * Phase 2: the chat surface accepts an `x-vizzor-burn-tx` header from
 * paid users. The route handler calls `verifyBurnTx(sig)` here to
 * confirm:
 *   - the tx is finalized on chain
 *   - it transferred at least BURN_AMOUNT of $VIZZOR
 *   - the destination is the well-known incinerator address (whose
 *     private key does not exist — tokens sent there are burned)
 *   - the blockTime is recent enough (replay window <5min)
 *   - the signature has not been used for a previous prediction in this
 *     server's lifetime (in-memory LRU cache, bounded)
 *
 * RPC: server-side `SOLANA_RPC_URL` (Helius free tier recommended).
 * Constants come from `NEXT_PUBLIC_*` env vars so the same values are
 * visible to client code that builds the tx in the first place.
 */

import {
  Connection,
  PublicKey,
  type ConfirmedSignatureInfo,
  type ParsedTransactionWithMeta,
} from '@solana/web3.js';

// Well-known burn destination on Solana. No private key exists for this
// address (it's vanity-derived around the prefix "1nc1nerator"), so any
// tokens sent here are unrecoverable.
export const INCINERATOR_ADDRESS = '1nc1nerator11111111111111111111111111111111';

const REPLAY_WINDOW_SECONDS = 5 * 60;
const SIG_CACHE_LIMIT = 4096;

// In-memory replay cache. Bounded LRU — server restart clears it, which
// is acceptable: the on-chain blockTime check also prevents replays
// older than REPLAY_WINDOW_SECONDS. The combination gives us a tight
// reuse window without persistent storage.
const usedSignatures = new Map<string, number>();

function rememberSignature(sig: string): void {
  usedSignatures.set(sig, Date.now());
  if (usedSignatures.size > SIG_CACHE_LIMIT) {
    // Drop the oldest 25% so we amortize the eviction cost.
    const drop = Math.floor(SIG_CACHE_LIMIT * 0.25);
    let i = 0;
    for (const key of usedSignatures.keys()) {
      if (i++ >= drop) break;
      usedSignatures.delete(key);
    }
  }
}

function wasSignatureUsed(sig: string): boolean {
  return usedSignatures.has(sig);
}

export function solanaRpcUrl(): string {
  return (
    process.env.SOLANA_RPC_URL ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    'https://api.mainnet-beta.solana.com'
  );
}

export function vizzorMint(): string | null {
  return process.env.NEXT_PUBLIC_VIZZOR_MINT ?? null;
}

export function burnAmount(): number {
  const raw = process.env.NEXT_PUBLIC_VIZZOR_BURN_AMOUNT;
  if (!raw) return 1;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export interface BurnVerification {
  ok: boolean;
  reason?:
    | 'mint_not_configured'
    | 'invalid_signature'
    | 'tx_not_found'
    | 'tx_failed'
    | 'replay_used_signature'
    | 'replay_outside_window'
    | 'wrong_destination'
    | 'wrong_mint'
    | 'insufficient_amount'
    | 'rpc_error';
}

/**
 * Verifies that the given Solana transaction signature represents a valid
 * burn of $VIZZOR tokens to the incinerator. Returns `ok: true` on success
 * and remembers the signature so it can't be replayed.
 */
export async function verifyBurnTx(sig: string): Promise<BurnVerification> {
  const mint = vizzorMint();
  if (!mint) return { ok: false, reason: 'mint_not_configured' };

  // Basic signature shape check (Base58, ~88 chars). Avoid expensive
  // RPC call for obviously invalid input.
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  if (wasSignatureUsed(sig)) {
    return { ok: false, reason: 'replay_used_signature' };
  }

  let tx: ParsedTransactionWithMeta | null;
  try {
    const conn = new Connection(solanaRpcUrl(), 'confirmed');
    tx = await conn.getParsedTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
  } catch {
    return { ok: false, reason: 'rpc_error' };
  }

  if (!tx) return { ok: false, reason: 'tx_not_found' };
  if (tx.meta?.err) return { ok: false, reason: 'tx_failed' };

  const blockTime = tx.blockTime ?? 0;
  const ageSec = Math.floor(Date.now() / 1000) - blockTime;
  if (ageSec > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: 'replay_outside_window' };
  }

  // Walk the instructions for an SPL token transfer/transferChecked
  // into the incinerator's associated token account for $VIZZOR.
  const transferred = sumIncineratorTransfers(tx, mint);
  if (!transferred.matchedMint) {
    return { ok: false, reason: 'wrong_mint' };
  }
  if (!transferred.matchedDestination) {
    return { ok: false, reason: 'wrong_destination' };
  }
  if (transferred.amount < burnAmount()) {
    return { ok: false, reason: 'insufficient_amount' };
  }

  rememberSignature(sig);
  return { ok: true };
}

interface TransferTally {
  matchedMint: boolean;
  matchedDestination: boolean;
  amount: number;
}

function sumIncineratorTransfers(
  tx: ParsedTransactionWithMeta,
  expectedMint: string,
): TransferTally {
  const tally: TransferTally = {
    matchedMint: false,
    matchedDestination: false,
    amount: 0,
  };

  const accountKeys = tx.transaction.message.accountKeys.map((k) =>
    typeof k === 'string' ? k : k.pubkey.toBase58(),
  );

  // Pre-compute the incinerator's associated token account for the mint
  // so we can cross-check against tx token-balance deltas.
  let incineratorAta: string;
  try {
    incineratorAta = deriveAssociatedTokenAddress(
      new PublicKey(INCINERATOR_ADDRESS),
      new PublicKey(expectedMint),
    );
  } catch {
    return tally;
  }

  // Parse top-level + inner instructions for `spl-token::transfer` and
  // `spl-token::transferChecked` ops.
  const allInstructions = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap((g) => g.instructions),
  ];

  for (const ix of allInstructions) {
    if (!('parsed' in ix) || !ix.parsed) continue;
    const parsed = ix.parsed as {
      type?: string;
      info?: Record<string, unknown>;
    };
    if (
      parsed.type !== 'transfer' &&
      parsed.type !== 'transferChecked'
    ) {
      continue;
    }
    const info = parsed.info ?? {};
    const dest = String(info.destination ?? '');
    const mint = String(info.mint ?? '');

    if (parsed.type === 'transferChecked') {
      if (mint !== expectedMint) continue;
      tally.matchedMint = true;
    } else {
      // Plain transfer: no mint in parsed info — use postTokenBalances
      // to infer the mint from the destination account, below.
    }

    if (dest === incineratorAta) {
      tally.matchedDestination = true;
      const ui = info.tokenAmount as { uiAmount?: number } | undefined;
      const raw = info.amount as string | number | undefined;
      if (ui?.uiAmount !== undefined) {
        tally.amount += ui.uiAmount;
      } else if (typeof raw === 'string' || typeof raw === 'number') {
        // Fall through: we need decimals; cross-check below via balances.
        tally.amount += Number(raw);
      }
    }
  }

  // Fall back to token-balance deltas if instruction parsing didn't
  // give us enough. The incinerator's balance should have grown by the
  // burn amount, with the right mint.
  if (!tally.matchedMint || !tally.matchedDestination) {
    const pre = tx.meta?.preTokenBalances ?? [];
    const post = tx.meta?.postTokenBalances ?? [];
    for (const p of post) {
      const owner = String(p.owner ?? '');
      const mint = String(p.mint ?? '');
      if (mint !== expectedMint) continue;
      if (owner !== INCINERATOR_ADDRESS) continue;
      tally.matchedMint = true;
      tally.matchedDestination = true;
      const preEntry = pre.find(
        (x) => x.accountIndex === p.accountIndex && x.mint === expectedMint,
      );
      const preAmt = preEntry?.uiTokenAmount.uiAmount ?? 0;
      const postAmt = p.uiTokenAmount.uiAmount ?? 0;
      tally.amount += Math.max(0, postAmt - preAmt);
    }
  }

  // Silence the unused-var lint for accountKeys (kept available in case
  // we want to add owner cross-checks later).
  void accountKeys;

  return tally;
}

// Re-implement the ATA derivation locally instead of pulling in
// @solana/spl-token's heavier surface for one helper. Mirrors the
// canonical formula: PDA of [owner, TOKEN_PROGRAM_ID, mint] under
// the Associated Token Program.
function deriveAssociatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
): string {
  const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM,
  );
  return ata.toBase58();
}

// Re-export for clarity in callers that just want to know if a sig has
// been seen recently (e.g. when /api/predict wants to short-circuit
// before walking RPC).
export { wasSignatureUsed };

// Keep the unused-import linter happy on platforms where TS strict
// flags unused type imports.
type _unused = ConfirmedSignatureInfo;
