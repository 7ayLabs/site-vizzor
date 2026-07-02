/**
 * GET /api/wallet/balance
 *
 * v0.5.1 — returns the connected wallet's SOL + SPL balances so the
 * composer can attach them as `wallet_context` on the /predict body.
 * The engine's LLM then knows what the user actually holds and can
 * write a trade plan that respects the balance ("you have 0.3 SOL —
 * this plan uses 0.15") instead of blind-quoting from thin air.
 *
 * Response shape (200 always when authenticated):
 *   {
 *     ok: true,
 *     wallet: "…",
 *     network: "mainnet-beta" | "devnet" | "testnet",
 *     as_of: 1751389200000,
 *     sol: 0.412,
 *     spl: [
 *       { mint: "…", symbol: "USDC", balance: 42.5, decimals: 6 },
 *       …
 *     ]
 *   }
 *
 * On RPC failure the route returns `{ ok: true, sol: null, spl: [], _stale: true }`
 * — that way the composer never blocks on this call. Prediction UX
 * degrades gracefully to "engine writes plans without balance context"
 * instead of failing the whole submit.
 *
 * Security posture:
 *   - SIWS gate; the WALLET is derived from the session (never from a
 *     query param).
 *   - Same per-wallet rate limit bucket as capability.enable (10/min).
 *   - `Cache-Control: no-store` because balances are money.
 */

import { NextResponse } from 'next/server';
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  clusterApiUrl,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getActiveSession } from '@/lib/payment/auth-session';
import { enforceWalletRateLimit } from '@/lib/payment/rate-limit';
import { paymentNetwork } from '@/lib/payment/network';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

interface SplHolding {
  mint: string;
  symbol: string | null;
  balance: number;
  decimals: number;
}

interface BalanceResponse {
  ok: true;
  wallet: string;
  network: 'mainnet-beta' | 'devnet' | 'testnet';
  as_of: number;
  sol: number | null;
  spl: SplHolding[];
  _stale?: true;
}

/**
 * Resolve the RPC endpoint the site's payment layer is aligned to.
 * Uses the same env cascade as `SolanaPayButton` so a devnet build
 * hits devnet balances, mainnet build hits mainnet balances. No
 * override for the balance route specifically — the goal is to
 * report what the user actually has on the network the site is
 * transacting on.
 */
function resolveRpc(): {
  url: string;
  network: 'mainnet-beta' | 'devnet' | 'testnet';
} {
  const net = paymentNetwork();
  const network: 'mainnet-beta' | 'devnet' | 'testnet' =
    net === 'mainnet' ? 'mainnet-beta' : net === 'testnet' ? 'testnet' : 'devnet';
  const configured =
    network === 'mainnet-beta'
      ? (process.env.NEXT_PUBLIC_SOLANA_RPC_URL_MAINNET ??
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL)
      : network === 'testnet'
        ? (process.env.NEXT_PUBLIC_SOLANA_RPC_URL_TESTNET ??
          process.env.NEXT_PUBLIC_SOLANA_RPC_URL)
        : (process.env.NEXT_PUBLIC_SOLANA_RPC_URL_DEVNET ??
          process.env.NEXT_PUBLIC_SOLANA_RPC_URL);
  return { url: configured ?? clusterApiUrl(network), network };
}

export async function GET(_req: Request) {
  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401, headers: NO_STORE },
    );
  }
  const limited = enforceWalletRateLimit(session.wallet, 'capability.enable');
  if (limited) return limited as unknown as NextResponse;

  let pk: PublicKey;
  try {
    pk = new PublicKey(session.wallet);
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_wallet' },
      { status: 400, headers: NO_STORE },
    );
  }
  const { url, network } = resolveRpc();
  const conn = new Connection(url, 'confirmed');
  const asOf = Date.now();

  // Parallelize the two reads. If either fails we fall back to a
  // "stale" body so the composer never blocks on this call.
  const [solRes, splRes] = await Promise.allSettled([
    conn.getBalance(pk, 'confirmed'),
    conn.getParsedTokenAccountsByOwner(
      pk,
      { programId: TOKEN_PROGRAM_ID },
      'confirmed',
    ),
  ]);

  const sol =
    solRes.status === 'fulfilled' ? solRes.value / LAMPORTS_PER_SOL : null;
  const spl: SplHolding[] =
    splRes.status === 'fulfilled'
      ? splRes.value.value
          .map((a): SplHolding | null => {
            const info = a.account.data.parsed?.info;
            const mint = typeof info?.mint === 'string' ? info.mint : null;
            const rawAmount = info?.tokenAmount?.uiAmount;
            const decimals =
              typeof info?.tokenAmount?.decimals === 'number'
                ? info.tokenAmount.decimals
                : 0;
            if (!mint || typeof rawAmount !== 'number' || rawAmount <= 0) {
              return null;
            }
            return { mint, symbol: null, balance: rawAmount, decimals };
          })
          .filter((x): x is SplHolding => x !== null)
          // Keep the response bounded — a wallet with 500 dust SPLs
          // shouldn't inflate the /predict body. Top-N by balance.
          .sort((a, b) => b.balance - a.balance)
          .slice(0, 20)
      : [];

  const body: BalanceResponse = {
    ok: true,
    wallet: session.wallet,
    network,
    as_of: asOf,
    sol,
    spl,
    ...(sol === null && spl.length === 0 ? { _stale: true as const } : {}),
  };
  return NextResponse.json(body, { headers: NO_STORE });
}
