/**
 * Payment session — site-owned creation + lookup.
 *
 * The site no longer proxies to a remote engine for payment session
 * state. Instead it mints sessions locally:
 *   1. Generates a unique session id
 *   2. Snapshots the current USD-to-token rate via getRate()
 *   3. Picks the treasury destination address for the chain
 *   4. Persists the session row in SQLite (`payment_sessions`)
 *   5. Returns the in-memory shape the UI expects
 *
 * The watcher daemon (lib/payment/watcher.ts) is what flips
 * `status='confirmed'` on the row once the on-chain transfer is seen.
 *
 * The previous engine-proxy exports stay in place for compatibility
 * with the existing route handlers — same function names, same
 * SessionResult union, just different internals.
 */

import { randomBytes } from 'node:crypto';
import { acceptTonPayments, acceptVizzorPayments, paymentRateLockSeconds } from '@/lib/feature-flags';
import {
  attachGrantCodeToSession,
  attachTelegramIdToSubscription,
  expireStaleSessions,
  findWalletLinkByWallet,
  getDb,
  getSessionRow,
  insertGrant,
  insertSession,
  insertSubscription,
  markSessionConfirmed,
  type SessionRow,
} from './db';
import { getRate } from './rates';
import { solanaTreasury, tonTreasury } from './treasury';

export type PaymentTier = 'pro' | 'elite';
export type PaymentCadence = 'monthly' | 'annual' | 'lifetime';
export type PaymentChain = 'ton' | 'solana';
export type PaymentToken = 'native' | 'vizzor';

export interface CreateSessionInput {
  tier: PaymentTier;
  cadence: PaymentCadence;
  chain: PaymentChain;
  token: PaymentToken;
  amountUsdCents: number;
  discountBps: number;
}

export interface PaymentSession {
  sessionId: string;
  destAddress: string;
  amount: number;
  decimals: number;
  amountUsdCents: number;
  tier: PaymentTier;
  cadence: PaymentCadence;
  chain: PaymentChain;
  token: PaymentToken;
  rateLocked: number;
  discountBps: number;
  expiresAt: number;
  status: 'pending' | 'confirmed' | 'expired' | 'failed';
  txSig?: string;
  confirmedAt?: number;
  grantCode?: string;
  /** Short memo string the wallet payload should carry (the session id). */
  memo: string;
}

export type SessionResult =
  | { ok: true; session: PaymentSession }
  | { ok: false; reason: SessionFailure };

export type SessionFailure =
  | 'feature_disabled'
  | 'rate_unavailable'
  | 'invalid_input';

const TON_DECIMALS = 9;
const VIZZOR_DECIMALS = 9;

function newSessionId(): string {
  // 16 random bytes → 22 chars base64url. Short, URL-safe, unique.
  return 'ses_' + randomBytes(16).toString('base64url');
}

export async function createSession(
  input: CreateSessionInput,
): Promise<SessionResult> {
  const isTon = input.chain === 'ton' && input.token === 'native';
  const isVizzor = input.chain === 'solana' && input.token === 'vizzor';

  if (isTon && !acceptTonPayments()) {
    return { ok: false, reason: 'feature_disabled' };
  }
  if (isVizzor && !acceptVizzorPayments()) {
    return { ok: false, reason: 'feature_disabled' };
  }
  if (!isTon && !isVizzor) {
    return { ok: false, reason: 'invalid_input' };
  }
  if (!['pro', 'elite'].includes(input.tier)) {
    return { ok: false, reason: 'invalid_input' };
  }
  if (!['monthly', 'annual', 'lifetime'].includes(input.cadence)) {
    return { ok: false, reason: 'invalid_input' };
  }
  if (
    !Number.isFinite(input.amountUsdCents) ||
    input.amountUsdCents < 49 ||
    input.amountUsdCents > 1_000_000
  ) {
    return { ok: false, reason: 'invalid_input' };
  }
  if (
    !Number.isFinite(input.discountBps) ||
    input.discountBps < 0 ||
    input.discountBps > 5000
  ) {
    return { ok: false, reason: 'invalid_input' };
  }

  // Snapshot the current rate.
  const rate = await getRate(isTon ? 'ton' : 'vizzor');
  if (!rate) return { ok: false, reason: 'rate_unavailable' };

  const usd = input.amountUsdCents / 100;
  const amount = Math.round((usd / rate.usdPer) * 100) / 100;
  const decimals = isTon ? TON_DECIMALS : VIZZOR_DECIMALS;
  const destAddress = isTon ? tonTreasury() : solanaTreasury();
  const sessionId = newSessionId();
  const expiresAt = Date.now() + paymentRateLockSeconds() * 1000;

  insertSession({
    session_id: sessionId,
    tier: input.tier,
    cadence: input.cadence,
    chain: input.chain,
    token: input.token,
    dest_address: destAddress,
    amount,
    decimals,
    amount_usd_cents: input.amountUsdCents,
    discount_bps: input.discountBps,
    rate_locked: rate.usdPer,
    expires_at: expiresAt,
    status: 'pending',
    memo: sessionId,
  });

  return {
    ok: true,
    session: {
      sessionId,
      destAddress,
      amount,
      decimals,
      amountUsdCents: input.amountUsdCents,
      tier: input.tier,
      cadence: input.cadence,
      chain: input.chain,
      token: input.token,
      rateLocked: rate.usdPer,
      discountBps: input.discountBps,
      expiresAt,
      status: 'pending',
      memo: sessionId,
    },
  };
}

export async function getSession(id: string): Promise<SessionResult> {
  if (!acceptTonPayments() && !acceptVizzorPayments()) {
    return { ok: false, reason: 'feature_disabled' };
  }
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(id)) {
    return { ok: false, reason: 'invalid_input' };
  }

  // Sweep stale-pending sessions to 'expired' so the UI sees the
  // correct state.
  expireStaleSessions(Date.now());

  const row = getSessionRow(id);
  if (!row) return { ok: false, reason: 'invalid_input' };

  return { ok: true, session: rowToSession(row) };
}

function rowToSession(r: SessionRow): PaymentSession {
  return {
    sessionId: r.session_id,
    destAddress: r.dest_address,
    amount: r.amount,
    decimals: r.decimals,
    amountUsdCents: r.amount_usd_cents,
    tier: r.tier as PaymentTier,
    cadence: r.cadence as PaymentCadence,
    chain: r.chain as PaymentChain,
    token: r.token as PaymentToken,
    rateLocked: r.rate_locked,
    discountBps: r.discount_bps,
    expiresAt: r.expires_at,
    status: r.status,
    txSig: r.tx_sig ?? undefined,
    confirmedAt: r.confirmed_at ?? undefined,
    grantCode: r.grant_code ?? undefined,
    memo: r.memo ?? r.session_id,
  };
}

const GRANT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Mint a grant code for a confirmed session. Idempotent: if the
 * session already has a grant attached, return that instead of
 * creating a new one.
 */
export async function issueGrantForSession(
  sessionId: string,
): Promise<{ code: string } | null> {
  const row = getSessionRow(sessionId);
  if (!row || row.status !== 'confirmed') return null;
  if (row.grant_code) return { code: row.grant_code };

  const code = 'g_' + randomBytes(12).toString('base64url');
  const expiresAt = Date.now() + GRANT_TTL_MS;
  insertGrant({ code, session_id: sessionId, expires_at: expiresAt });
  attachGrantCodeToSession(sessionId, code);
  return { code };
}

/* ------------------------------------------------------------------ *\
 * finalizeSession — the per-chain watcher's terminal step.
 *
 * Called by every chain watcher (Solana / TON / EVM) once an on-chain
 * transfer has been matched to a pending session. Wraps the five
 * post-confirm operations in a single SQLite transaction so a mid-flow
 * crash rolls back cleanly:
 *
 *   1. Re-read the session and assert status === 'pending'. Defends
 *      against duplicate confirmations from reorgs, watcher retries,
 *      or two RPC providers both reporting the same tx.
 *   2. markSessionConfirmed — flips status, attaches tx signature.
 *   3. insertSubscription with cadence-derived expiry (monthly +30d,
 *      annual +365d, lifetime null).
 *   4. issueGrantForSession — mints a 24h single-use bot-handoff
 *      grant code, attaches it to the session row.
 *   5. Express lane — if the payer wallet is already in wallet_links,
 *      eagerly back-fill subscriptions.telegram_user_id so the user
 *      has bot access without a grant redemption round-trip. This is
 *      the load-bearing seam between the wallet-telegram-binding
 *      slice and the web3-purchase-flow slice (plan §10.3 step 5).
 *
 * Returns the subscription id + grant code so the caller can log /
 * surface them. `confirmed: false` means the session was no longer
 * pending — the caller should skip without warnings, since this is
 * the expected branch under reorg/retry.
\* ------------------------------------------------------------------ */

export interface FinalizeResult {
  confirmed: boolean;
  subscriptionId?: number;
  grantCode?: string;
  walletLinkedTo?: number;
}

export function cadenceExpiry(cadence: string): number | null {
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

export function finalizeSession(
  session: SessionRow,
  txSig: string,
  payer: string,
): FinalizeResult {
  const db = getDb();
  // better-sqlite3 transactions are synchronous and atomic. Either
  // every statement commits or none of them do.
  const run = db.transaction((): FinalizeResult => {
    const fresh = getSessionRow(session.session_id);
    if (!fresh || fresh.status !== 'pending') {
      return { confirmed: false };
    }

    markSessionConfirmed(session.session_id, txSig, payer, Date.now());

    // No payer (very rare — chain didn't yield a sender) still
    // confirms the session but skips subscription minting. A manual
    // operator query can backfill if needed.
    if (!payer) {
      return { confirmed: true };
    }

    const subscriptionId = insertSubscription({
      wallet_address: payer,
      tier: session.tier,
      cadence: session.cadence,
      expires_at: cadenceExpiry(session.cadence),
      session_id: session.session_id,
    });

    const code = 'g_' + randomBytes(12).toString('base64url');
    const grantExpiresAt = Date.now() + GRANT_TTL_MS;
    insertGrant({
      code,
      session_id: session.session_id,
      expires_at: grantExpiresAt,
    });
    attachGrantCodeToSession(session.session_id, code);

    // Express lane: if the payer wallet was pre-linked to a TG user
    // via /api/wallet-links, eagerly attach the TG id to the freshly
    // minted subscription so the user has bot access without a grant
    // redemption round-trip.
    const link = findWalletLinkByWallet(payer);
    if (link) {
      attachTelegramIdToSubscription(subscriptionId, link.telegram_user_id);
      return {
        confirmed: true,
        subscriptionId,
        grantCode: code,
        walletLinkedTo: link.telegram_user_id,
      };
    }

    return { confirmed: true, subscriptionId, grantCode: code };
  });
  return run();
}
