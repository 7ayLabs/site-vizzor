/**
 * POST /api/grants/[code]/redeem — bot-side grant redemption (v0.2.0).
 *
 * Closes the v0.1.0 gap where `redeemGrant(code, telegramUserId)` in
 * `lib/payment/db.ts` had no HTTP caller. The Telegram bot now calls
 * this route after the user clicks `t.me/<bot>?start=g_<code>`; on a
 * successful redemption the bot replies with the subscription tier and
 * the user is bound to the site's `subscriptions` row from this point.
 *
 * Contract: `docs/rfc/v0.2.0/wallet-telegram-binding.md` §5.
 *
 * Auth: `x-vizzor-bot-token` shared secret via `requireBotSecret`. The
 * route never tells the caller whether the header was absent or wrong;
 * both collapse to `401 { ok: false, reason: 'unauthorized' }`.
 *
 * Body: `{ telegram_user_id: number, telegram_username?: string }`.
 * `telegram_username` is accepted but not persisted in v0.2.0 — usernames
 * are mutable on Telegram and are not a reliable identifier.
 *
 * Idempotency: retry-safe by the `(code, telegram_user_id)` pair. A
 * second call with the same TG id is a 200 echo of the first
 * redemption's subscription row, not a conflict. A call with a
 * different TG id is `409 already_redeemed`.
 *
 * Failure shapes (RFC §5):
 *   - 400 `invalid_code`           — code does not match the shape regex
 *                                    or no row exists in `grants`
 *   - 400 `invalid_input`          — body missing or malformed
 *   - 409 `already_redeemed`       — grant was redeemed by a different TG
 *   - 410 `expired`                — now > grants.expires_at
 *   - 412 `session_not_confirmed`  — underlying session is not confirmed
 *   - 401 `unauthorized`           — bot-auth failed
 *   - 500 `internal_error`         — transaction rolled back; safe to retry
 *
 * Transactional shape: the SQLite transaction wraps the grant update,
 * the subscription back-fill, and the wallet_links upsert so a partial
 * write never escapes. better-sqlite3 transactions are synchronous and
 * roll back on any thrown exception.
 */

import { NextResponse } from 'next/server';
import {
  attachTelegramIdToSubscription,
  findSubscriptionBySessionId,
  findWalletLinkByWallet,
  getDb,
  getGrant,
  insertWalletLink,
  redeemGrant,
  type SubscriptionRow,
} from '@/lib/payment/db';
import { requireBotSecret } from '@/lib/payment/bot-auth';
import { enforceRateLimit } from '@/lib/payment/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GRANT_CODE_RE = /^g_[A-Za-z0-9_-]{16}$/;

interface RedeemBody {
  telegram_user_id?: unknown;
  telegram_username?: unknown;
}

type WireSubscription = {
  tier: string;
  cadence: string;
  expires_at: number | null;
  wallet_address: string;
};

function toWireSubscription(row: SubscriptionRow): WireSubscription {
  return {
    tier: row.tier,
    cadence: row.cadence,
    expires_at: row.expires_at,
    wallet_address: row.wallet_address,
  };
}

function jsonNoStore(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const limited = enforceRateLimit(req, 'grants.redeem');
  if (limited) return limited as unknown as NextResponse;

  const auth = requireBotSecret(req);
  if (!auth.ok) {
    return jsonNoStore({ ok: false, reason: 'unauthorized' }, 401);
  }

  const { code } = await ctx.params;
  if (typeof code !== 'string' || !GRANT_CODE_RE.test(code)) {
    return jsonNoStore({ ok: false, reason: 'invalid_code' }, 400);
  }

  let body: RedeemBody;
  try {
    body = (await req.json()) as RedeemBody;
  } catch {
    return jsonNoStore({ ok: false, reason: 'invalid_input' }, 400);
  }
  const telegramUserId = Number(body.telegram_user_id);
  if (
    !Number.isFinite(telegramUserId) ||
    !Number.isInteger(telegramUserId) ||
    telegramUserId <= 0
  ) {
    return jsonNoStore({ ok: false, reason: 'invalid_input' }, 400);
  }
  // telegram_username is accepted but not persisted (RFC §5).
  void body.telegram_username;

  // First pass: read-only checks that do not need a transaction.
  const grant = getGrant(code);
  if (!grant) {
    return jsonNoStore({ ok: false, reason: 'invalid_code' }, 400);
  }
  const now = Date.now();
  if (grant.expires_at <= now) {
    return jsonNoStore({ ok: false, reason: 'expired' }, 410);
  }

  // Idempotency: same TG id redeeming the same code again is 200 with
  // the existing subscription row. A different TG id is 409.
  if (grant.redeemed_by !== null) {
    if (grant.redeemed_by !== telegramUserId) {
      return jsonNoStore({ ok: false, reason: 'already_redeemed' }, 409);
    }
    const existing = findSubscriptionBySessionId(grant.session_id);
    if (!existing) {
      // Defensive: the grant claims redeemed but no subscription
      // exists. Treat as an internal-consistency failure rather than a
      // happy idempotent reply, because we cannot serve the contract's
      // success shape without a subscription row.
      return jsonNoStore({ ok: false, reason: 'internal_error' }, 500);
    }
    return jsonNoStore(
      { ok: true, subscription: toWireSubscription(existing) },
      200,
    );
  }

  const subscription = findSubscriptionBySessionId(grant.session_id);
  if (!subscription) {
    // No subscription row means `finalizeSession` has not run, which
    // means the on-chain payment is not confirmed. Surface as
    // `session_not_confirmed` (412) — the caller's correct response is
    // to retry after the watcher catches up.
    return jsonNoStore({ ok: false, reason: 'session_not_confirmed' }, 412);
  }

  // Wallet-link conflict: the wallet is already linked to a *different*
  // TG user. We do not silently re-attribute. The grant remains
  // unredeemed; the bot is told `already_redeemed` so its user-facing
  // copy reads consistently with the social-engineering threat model
  // even though the violation is on the link side, not the grant side.
  const existingLink = findWalletLinkByWallet(subscription.wallet_address);
  if (existingLink && existingLink.telegram_user_id !== telegramUserId) {
    return jsonNoStore({ ok: false, reason: 'already_redeemed' }, 409);
  }
  const existingLinkForTg =
    existingLink?.telegram_user_id === telegramUserId ? existingLink : null;
  // A different wallet linked to this TG id is also a 409. The TG
  // user is expected to redeem on their already-linked wallet.
  if (!existingLinkForTg) {
    const db = getDb();
    const rowForTg = db
      .prepare(
        `SELECT * FROM wallet_links WHERE telegram_user_id = ? AND wallet_address != ?`,
      )
      .get(telegramUserId, subscription.wallet_address);
    if (rowForTg) {
      return jsonNoStore({ ok: false, reason: 'already_redeemed' }, 409);
    }
  }

  // Atomic mutation: redeem + attach + link. The transaction is
  // synchronous; any throw rolls everything back.
  let attachedRow: SubscriptionRow | null = null;
  try {
    const db = getDb();
    const tx = db.transaction(() => {
      // 1. Mark the grant redeemed. Returns 0 changes if a concurrent
      //    redemption beat us; we re-check below.
      redeemGrant(code, telegramUserId);
      const reread = getGrant(code);
      if (!reread || reread.redeemed_by !== telegramUserId) {
        // Concurrent redemption by another TG id slipped between our
        // initial read and this transaction. Roll back by throwing.
        throw new Error('CONFLICT_REDEEM');
      }
      // 2. Back-fill telegram_user_id on the subscription row. If it is
      //    already populated with the same id (idempotent retry), the
      //    UPDATE no-ops; if a different id, we throw to roll back.
      const attached = attachTelegramIdToSubscription(
        subscription.id,
        telegramUserId,
      );
      if (
        !attached.changed &&
        subscription.telegram_user_id !== telegramUserId
      ) {
        // The subscription row's telegram_user_id is occupied by a
        // different user. Rolling back keeps the grant unredeemed.
        throw new Error('CONFLICT_SUB_BOUND');
      }
      // 3. Wallet-link upsert. `INSERT OR IGNORE` is correct here:
      //    the (telegram_user_id, wallet_address) pair may already
      //    exist (idempotent retry), but the unique indexes on either
      //    column would also block a re-attribution, which is the
      //    behavior we want.
      insertWalletLink({
        telegram_user_id: telegramUserId,
        wallet_address: subscription.wallet_address,
        siws_token: null,
      });
    });
    tx();
    attachedRow = findSubscriptionBySessionId(grant.session_id);
  } catch (err) {
    const reason =
      err instanceof Error && err.message === 'CONFLICT_REDEEM'
        ? 'already_redeemed'
        : err instanceof Error && err.message === 'CONFLICT_SUB_BOUND'
          ? 'already_redeemed'
          : 'internal_error';
    const status = reason === 'already_redeemed' ? 409 : 500;
    return jsonNoStore({ ok: false, reason }, status);
  }

  if (!attachedRow) {
    return jsonNoStore({ ok: false, reason: 'internal_error' }, 500);
  }

  return jsonNoStore(
    { ok: true, subscription: toWireSubscription(attachedRow) },
    200,
  );
}
