/**
 * Payment session — site-owned creation + lookup.
 *
 * v0.2.0 ships Solana-native-only. Each session locks a SOL amount,
 * snapshots the USD-to-SOL rate, and embeds the session_id as the
 * on-chain memo so the watcher can demux confirmations at the shared
 * treasury.
 *
 * Flow:
 *   1. Generate a unique session id
 *   2. Snapshot the current USD-to-SOL rate via getRate('sol')
 *   3. Persist the session row in SQLite (`payment_sessions`)
 *   4. Return the in-memory shape the UI expects
 *
 * The watcher daemon (lib/payment/watcher.ts) flips
 * `status='confirmed'` on the row once the on-chain transfer is seen.
 */

import { randomBytes } from 'node:crypto';
import {
  acceptSolanaPayments,
  paymentRateLockSeconds,
} from '@/lib/feature-flags';
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
import { claimNext, type ClaimedAddress } from './address-pool';
import { acceptTonPayments } from '@/lib/feature-flags';

export type PaymentTier = 'pro' | 'elite';
export type PaymentCadence = 'monthly' | 'annual' | 'lifetime';
// USDC on Base / Arbitrum dropped in v0.4 — neither chain had a settled
// watcher. The union stays parameterised so re-introducing a chain
// later is a one-line edit; the `payment_sessions` schema keeps
// `chain`/`token` as flexible strings so no migration is needed.
export type PaymentChain = 'solana' | 'ton';
export type PaymentToken = 'native';

/** Combinations the checkout shell offers and the engine knows how to settle. */
export const SUPPORTED_PAIRS = [
  { chain: 'solana', token: 'native' },
  { chain: 'ton', token: 'native' },
] as const;

export function isSupportedPair(chain: string, token: string): boolean {
  return SUPPORTED_PAIRS.some(
    (p) => p.chain === chain && p.token === token,
  );
}

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

const SOL_DECIMALS = 9;
const TON_DECIMALS = 9;

function decimalsFor(chain: PaymentChain, _token: PaymentToken): number {
  if (chain === 'ton') return TON_DECIMALS;
  return SOL_DECIMALS;
}

function priceTokenFor(
  chain: PaymentChain,
  _token: PaymentToken,
): 'sol' | 'ton' {
  if (chain === 'ton') return 'ton';
  return 'sol';
}

/**
 * Resolve the destination address for a new session.
 *
 * Watch-only HD model (v0.4+): every session gets a unique
 * pre-derived address from the operator-uploaded pool, so two
 * customers never pay into the same address (privacy + replay
 * safety). Pool is consumed atomically via `claimNext`.
 *
 * Backwards-compat fallback: if the pool env var is unset (or the
 * pool file is missing), fall back to the legacy static-treasury env
 * var so an operator who hasn't migrated yet keeps accepting payments
 * — at the cost of address reuse. Log a deprecation warning so the
 * runbook gap is visible. Once the operator provisions a pool, the
 * primary path takes over with zero code change.
 */
function destinationFor(
  chain: PaymentChain,
): { dest: string; poolIndex: number | null } {
  if (chain === 'ton') {
    return tryClaimFromPool('ton') ?? legacyStatic('ton', tonTreasury);
  }
  return tryClaimFromPool('solana') ?? legacyStatic('solana', solanaTreasury);
}

function tryClaimFromPool(
  chain: 'solana' | 'ton',
): { dest: string; poolIndex: number } | null {
  const envName =
    chain === 'solana'
      ? 'VIZZOR_SOLANA_ADDRESS_POOL_PATH'
      : 'VIZZOR_TON_ADDRESS_POOL_PATH';
  if (!process.env[envName]) return null;
  let claimed: ClaimedAddress;
  try {
    claimed = claimNext(chain);
  } catch (e) {
    // Pool exhausted or unreadable — surface upstream via the same
    // session_failed reason. Caller logs the actual cause.
    throw new Error(
      `pool_unavailable_${chain}: ${(e as Error).message}`,
    );
  }
  return { dest: claimed.address, poolIndex: claimed.index };
}

function legacyStatic(
  chain: 'solana' | 'ton',
  resolver: () => string,
): { dest: string; poolIndex: null } {
  // eslint-disable-next-line no-console
  console.warn(
    `[vizzor-payment] using legacy static treasury for ${chain} — set ${chain === 'solana' ? 'VIZZOR_SOLANA_ADDRESS_POOL_PATH' : 'VIZZOR_TON_ADDRESS_POOL_PATH'} to enable the watch-only HD pool (privacy + per-session address freshness). See docs/ops/treasury-setup.md.`,
  );
  return { dest: resolver(), poolIndex: null };
}

function newSessionId(): string {
  // 16 random bytes → 22 chars base64url. Short, URL-safe, unique.
  return 'ses_' + randomBytes(16).toString('base64url');
}

export async function createSession(
  input: CreateSessionInput,
): Promise<SessionResult> {
  // Input validation runs first so callers get a deterministic
  // `invalid_input` for malformed requests regardless of feature-flag
  // state. Feature gate is checked only once the shape is known good.
  if (!isSupportedPair(input.chain, input.token)) {
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
  // Per-chain feature gate. Each chain has its own flag so the
  // operator can roll out SOL or TON independently. A request for a
  // disabled chain returns the same `feature_disabled` reason the
  // UI knows how to render.
  if (input.chain === 'solana' && !acceptSolanaPayments()) {
    return { ok: false, reason: 'feature_disabled' };
  }
  if (input.chain === 'ton' && !acceptTonPayments()) {
    return { ok: false, reason: 'feature_disabled' };
  }

  const priceToken = priceTokenFor(input.chain, input.token);
  const rate = await getRate(priceToken);
  if (!rate) return { ok: false, reason: 'rate_unavailable' };

  const sessionId = newSessionId();
  const usd = input.amountUsdCents / 100;
  // 4-decimal precision is small enough to avoid rounding issues yet
  // large enough that wallet UIs render clean numbers.
  const amount = Math.round((usd / rate.usdPer) * 10000) / 10000;
  const decimals = decimalsFor(input.chain, input.token);

  // Resolve the per-session destination. Throws when the pool is
  // exhausted; the caller (POST /api/payment/session) catches and
  // surfaces it as `internal_error` with the underlying message.
  const { dest: destAddress, poolIndex } = destinationFor(input.chain);
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
    pool_index: poolIndex,
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
  if (!acceptSolanaPayments()) {
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
 * finalizeSession — the watcher's terminal step.
 *
 * Called by the Solana watcher once an on-chain transfer has been
 * matched to a pending session. Wraps the five post-confirm
 * operations in a single SQLite transaction so a mid-flow crash rolls
 * back cleanly:
 *
 *   1. Re-read the session and assert status === 'pending'. Defends
 *      against duplicate confirmations from reorgs / watcher retries.
 *   2. markSessionConfirmed — flips status, attaches tx signature.
 *   3. insertSubscription with cadence-derived expiry (monthly +30d,
 *      annual +365d, lifetime null).
 *   4. issueGrantForSession — mints a 24h single-use bot-handoff
 *      grant code, attaches it to the session row.
 *   5. Express lane — if the payer wallet is already in wallet_links,
 *      eagerly back-fill subscriptions.telegram_user_id so the user
 *      has bot access without a grant redemption round-trip.
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
  const run = db.transaction((): FinalizeResult => {
    const fresh = getSessionRow(session.session_id);
    if (!fresh || fresh.status !== 'pending') {
      return { confirmed: false };
    }

    markSessionConfirmed(session.session_id, txSig, payer, Date.now());

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
  const result = run();

  // Outbound webhook to the engine — fired AFTER the transaction
  // commits so the engine never sees a tier update for a row that
  // failed to insert. Best-effort: a failed webhook just means the
  // engine's 60-second cache picks up the change on the next chat
  // command via its periodic lookup against /api/subscriptions/lookup.
  // The site is the source of truth; this is purely a UX optimization
  // to flip the bot's tier badge instantly after the web checkout.
  if (result.confirmed && payer) {
    void notifyEngineSubscriptionUpdated({
      wallet: payer,
      telegramUserId: result.walletLinkedTo ?? null,
      tier: session.tier,
    });
  }

  return result;
}

interface EngineWebhookPayload {
  wallet: string;
  telegramUserId: number | null;
  tier: string;
}

/**
 * Fire-and-forget POST to the engine's subscription-cache invalidator.
 * The engine module that handles this (`src/api/routes/internal/
 * subscription-updated.ts`) expects the `X-Vizzor-Bot-Token` shared
 * secret. When `VIZZOR_API_URL` or `VIZZOR_BOT_TOKEN` is unset (dev /
 * CI), we log + skip. When the engine is unreachable, we log + swallow
 * — the engine's own 60-second cache window guarantees eventual
 * consistency without this hook.
 */
async function notifyEngineSubscriptionUpdated(
  payload: EngineWebhookPayload,
): Promise<void> {
  const base =
    process.env.VIZZOR_API_URL ??
    process.env.NEXT_PUBLIC_VIZZOR_API_URL ??
    '';
  const token = process.env.VIZZOR_BOT_TOKEN ?? '';
  if (!base || !token) {
    // eslint-disable-next-line no-console
    console.warn(
      '[vizzor-payment] skipping engine webhook (VIZZOR_API_URL or VIZZOR_BOT_TOKEN missing) — engine cache will refresh on next lookup',
    );
    return;
  }
  const url = `${base.replace(/\/+$/, '')}/v1/internal/subscription-updated`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'X-Vizzor-Bot-Token': token,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[vizzor-payment] engine webhook returned ${res.status} for wallet=${payload.wallet.slice(0, 6)}…`,
      );
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[vizzor-payment] engine webhook failed for wallet=${payload.wallet.slice(0, 6)}…:`,
      (e as Error)?.message ?? e,
    );
  } finally {
    clearTimeout(timeout);
  }
}
