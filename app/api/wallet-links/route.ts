/**
 * POST /api/wallet-links — pre-link a Solana wallet to a Telegram user
 * (v0.2.0).
 *
 * Bot-initiated path of the hybrid identity model (RFC §2). The bot
 * mints a link request, the user signs a SIWS message scoped to the
 * `link-wallet` action with their Telegram user id bound into the
 * message, and the bot relays the signed payload to this route. On a
 * valid signature, we durably insert the binding into `wallet_links`.
 *
 * Contract: `docs/rfc/v0.2.0/wallet-telegram-binding.md` §6.
 *
 * Auth: `x-vizzor-bot-token` shared secret via `requireBotSecret`. The
 * shared secret authenticates that the *bot* is making the request; the
 * SIWS signature authenticates that the *wallet owner* approves the
 * link. Both are required — neither one alone is sufficient. The
 * shared secret prevents the route from becoming a spam endpoint that
 * any anonymous client can spray nonsense at; the signature prevents
 * the bot from unilaterally claiming wallets.
 *
 * Body:
 *   {
 *     telegram_user_id: number,
 *     wallet:           string,         // base58 Solana pubkey (signer)
 *     signature:        string,         // base58 or base64 ed25519 sig
 *     nonce:            string,         // hex nonce echoed from message
 *     issued_at:        string (ISO),   // echoed from message
 *     expires_at:       string (ISO)    // echoed from message
 *   }
 *
 * The site reconstructs the canonical link message from the inputs via
 * `buildLinkWalletMessage` and verifies the signature with the existing
 * ed25519 helper. Reconstruction (not trusting a client-supplied
 * message string) keeps the message contract entirely server-owned.
 *
 * Failure shapes:
 *   - 400 `invalid_input`            — missing/malformed field
 *   - 401 `unauthorized`             — bot-auth failed
 *   - 401 `invalid_signature`        — signature does not verify
 *   - 410 `expired`                  — `expires_at` is in the past
 *   - 409 `already_linked_elsewhere` — wallet OR TG id already bound to
 *                                       a different counterpart
 *
 * Idempotency: a request that re-asserts the *same* binding returns
 * `200 { ok: true, already_linked: true }`. A request that conflicts on
 * either uniqueness axis returns `409 already_linked_elsewhere` — we
 * never silently re-attribute a wallet to a different TG user (RFC §3:
 * silent re-attribution would hide social-engineering attempts).
 */

import { NextResponse } from 'next/server';
import {
  buildLinkWalletMessage,
  isValidSolanaAddress,
  verifySiwsSignature,
} from '@/lib/payment/siws';
import {
  findWalletLinkByTelegramId,
  findWalletLinkByWallet,
  insertWalletLink,
} from '@/lib/payment/db';
import { requireBotSecret } from '@/lib/payment/bot-auth';
import { enforceRateLimit } from '@/lib/payment/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface LinkBody {
  telegram_user_id?: unknown;
  wallet?: unknown;
  signature?: unknown;
  nonce?: unknown;
  issued_at?: unknown;
  expires_at?: unknown;
}

const NONCE_RE = /^[0-9a-f]{16,128}$/;

function jsonNoStore(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function parseIso(s: unknown): Date | null {
  if (typeof s !== 'string' || s.length === 0) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function POST(req: Request): Promise<NextResponse> {
  const limited = enforceRateLimit(req, 'wallet-links.write');
  if (limited) return limited as unknown as NextResponse;

  const auth = requireBotSecret(req);
  if (!auth.ok) {
    return jsonNoStore({ ok: false, reason: 'unauthorized' }, 401);
  }

  let body: LinkBody;
  try {
    body = (await req.json()) as LinkBody;
  } catch {
    return jsonNoStore({ ok: false, reason: 'invalid_input' }, 400);
  }

  const telegramUserId = Number(body.telegram_user_id);
  const wallet = typeof body.wallet === 'string' ? body.wallet : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  const nonce = typeof body.nonce === 'string' ? body.nonce : '';
  const issuedAt = parseIso(body.issued_at);
  const expiresAt = parseIso(body.expires_at);

  if (
    !Number.isFinite(telegramUserId) ||
    !Number.isInteger(telegramUserId) ||
    telegramUserId <= 0 ||
    !isValidSolanaAddress(wallet) ||
    signature.length === 0 ||
    !NONCE_RE.test(nonce) ||
    !issuedAt ||
    !expiresAt
  ) {
    return jsonNoStore({ ok: false, reason: 'invalid_input' }, 400);
  }

  const now = Date.now();
  if (expiresAt.getTime() <= now) {
    return jsonNoStore({ ok: false, reason: 'expired' }, 410);
  }
  // Sanity-check: `issuedAt` cannot be wildly future-dated. A 5-minute
  // forward skew is the upper bound we accept; anything further is a
  // clock-skew anomaly or a forged value.
  if (issuedAt.getTime() - now > 5 * 60 * 1000) {
    return jsonNoStore({ ok: false, reason: 'invalid_input' }, 400);
  }
  // `issuedAt` must precede `expiresAt`.
  if (issuedAt.getTime() >= expiresAt.getTime()) {
    return jsonNoStore({ ok: false, reason: 'invalid_input' }, 400);
  }

  // Reconstruct the canonical link message server-side. We never trust
  // a client-supplied message string; the signature must match the
  // bytes we compute from the parts we accept.
  const message = buildLinkWalletMessage({
    wallet,
    telegramUserId,
    nonce,
    issuedAt,
    expiresAt,
  });

  if (!verifySiwsSignature(message, signature, wallet)) {
    return jsonNoStore({ ok: false, reason: 'invalid_signature' }, 401);
  }

  // Conflict detection before insert. The unique indexes on
  // `wallet_address` and `telegram_user_id` will catch races, but
  // pre-checking lets us distinguish "same binding being re-asserted"
  // (idempotent 200) from "wallet bound elsewhere" (409).
  const existingByWallet = findWalletLinkByWallet(wallet);
  const existingByTg = findWalletLinkByTelegramId(telegramUserId);

  if (existingByWallet && existingByWallet.telegram_user_id === telegramUserId) {
    // Exactly this binding already exists — idempotent success.
    return jsonNoStore({ ok: true, already_linked: true }, 200);
  }
  if (existingByWallet || existingByTg) {
    return jsonNoStore(
      { ok: false, reason: 'already_linked_elsewhere' },
      409,
    );
  }

  // Strict insert: any concurrent insert that violates either unique
  // index throws, which we map to 409. We pass the signature as the
  // forensic trail (`siws_token` column), so an operator can audit
  // exactly what bytes the wallet signed at link time.
  try {
    const r = insertWalletLink(
      {
        telegram_user_id: telegramUserId,
        wallet_address: wallet,
        siws_token: signature,
      },
      { strict: true },
    );
    if (!r.inserted) {
      // Should be unreachable with strict=true (it throws on conflict)
      // but defend against future helper changes.
      return jsonNoStore(
        { ok: false, reason: 'already_linked_elsewhere' },
        409,
      );
    }
  } catch (err) {
    // better-sqlite3 surfaces the unique-constraint error with code
    // `SQLITE_CONSTRAINT_UNIQUE`. We collapse all constraint failures
    // to 409 and let any other error bubble as a 500.
    const code = (err as { code?: string } | null)?.code ?? '';
    if (code.startsWith('SQLITE_CONSTRAINT')) {
      return jsonNoStore(
        { ok: false, reason: 'already_linked_elsewhere' },
        409,
      );
    }
    return jsonNoStore({ ok: false, reason: 'internal_error' }, 500);
  }

  return jsonNoStore({ ok: true, already_linked: false }, 200);
}
