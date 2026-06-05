/**
 * Server-only Solana helpers — burn-tx verification and the ATA
 * self-test that gates it.
 *
 * Lives in a separate file from `lib/solana.ts` so client components
 * (`burn-button`, `vizzor-pay-button`, `wallet-provider`, etc.) can
 * keep importing the shared constants without dragging the SQLite
 * persistent replay cache (and therefore `better-sqlite3` / `node:fs`)
 * into the client bundle.
 *
 * Server callers (`app/api/predict/route.ts`,
 * `app/api/verify-burn/route.ts`) import `verifyBurnTx` from here.
 */

import 'server-only';
import {
  Connection,
  PublicKey,
  type ParsedTransactionWithMeta,
} from '@solana/web3.js';
import {
  hasSignature,
  rememberSignature,
} from './payment/replay-cache';
import {
  INCINERATOR_ADDRESS,
  burnAmount,
  solanaRpcUrl,
  vizzorMint,
} from './solana';

const REPLAY_WINDOW_SECONDS = 5 * 60;

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
    | 'rpc_error'
    | 'ata_self_test_failed';
}

/* ------------------------------------------------------------------ *\
 * Startup ATA self-test (RFC §6.2 / B1).
 *
 * Defends against a supply-chain compromise of `@solana/web3.js` whose
 * `PublicKey.findProgramAddressSync` could return an attacker-influenced
 * PDA. We derive the incinerator ATA once per process and compare it to
 * an operator-supplied known-good value (`VIZZOR_EXPECTED_INCINERATOR_ATA`).
 * On mismatch every subsequent `verifyBurnTx` call fails closed.
 *
 * When the env var is unset the self-test is a no-op — there is nothing
 * to compare against. This preserves dev / staging behavior; the env is
 * expected to land via C6's `.env.example` registry for production.
 *
 * Memoized so the assertion runs once. Memoization is keyed by mint so
 * a config change at runtime (e.g. a new `NEXT_PUBLIC_VIZZOR_MINT`) is
 * re-validated. A failure latches for that mint until the process
 * restarts.
\* ------------------------------------------------------------------ */

interface AtaSelfTestState {
  mint: string;
  passed: boolean;
}
let ataSelfTestState: AtaSelfTestState | null = null;

function runAtaSelfTest(mint: string): boolean {
  if (ataSelfTestState && ataSelfTestState.mint === mint) {
    return ataSelfTestState.passed;
  }
  const expected = process.env.VIZZOR_EXPECTED_INCINERATOR_ATA;
  if (!expected) {
    ataSelfTestState = { mint, passed: true };
    return true;
  }
  let derived: string;
  try {
    derived = deriveAssociatedTokenAddress(
      new PublicKey(INCINERATOR_ADDRESS),
      new PublicKey(mint),
    );
  } catch {
    ataSelfTestState = { mint, passed: false };
    return false;
  }
  const passed = derived === expected;
  ataSelfTestState = { mint, passed };
  return passed;
}

/**
 * Verifies that the given Solana transaction signature represents a valid
 * burn of $VIZZOR tokens to the incinerator. Returns `ok: true` on success
 * and remembers the signature so it can't be replayed.
 */
export async function verifyBurnTx(sig: string): Promise<BurnVerification> {
  const mint = vizzorMint();
  if (!mint) return { ok: false, reason: 'mint_not_configured' };

  if (!runAtaSelfTest(mint)) {
    return { ok: false, reason: 'ata_self_test_failed' };
  }

  // Basic signature shape check (Base58, ~88 chars). Avoid expensive
  // RPC call for obviously invalid input.
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  if (hasSignature(sig)) {
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

  let incineratorAta: string;
  try {
    incineratorAta = deriveAssociatedTokenAddress(
      new PublicKey(INCINERATOR_ADDRESS),
      new PublicKey(expectedMint),
    );
  } catch {
    return tally;
  }

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
    }

    if (dest === incineratorAta) {
      tally.matchedDestination = true;
      const ui = info.tokenAmount as { uiAmount?: number } | undefined;
      const raw = info.amount as string | number | undefined;
      if (ui?.uiAmount !== undefined) {
        tally.amount += ui.uiAmount;
      } else if (typeof raw === 'string' || typeof raw === 'number') {
        tally.amount += Number(raw);
      }
    }
  }

  // Fall back to token-balance deltas if instruction parsing didn't
  // give us enough. Robust to RPC providers that elide parsed info and
  // to a single compromised dependency that returns a wrong ATA above.
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
