/**
 * GET /api/wallet-links/lookup?telegram_user_id={id} — bot-side
 * wallet-link existence check.
 *
 * Companion to `/api/subscriptions/lookup`. The site's subscription
 * lookup can't distinguish "wallet not linked" from "wallet linked, no
 * active sub" because both surface as `subscription: null`. The
 * engine's `/start` handler needs that distinction to branch correctly:
 *
 *   - No wallet link → Case A (anonymous): prompt /setup, no free
 *     trial granted, no Pro features. Funnel into wallet pair.
 *   - Wallet linked, no sub → Case B: offer the 7-day Pro trial as a
 *     one-time grant (only if `hasUsedTrial` returns false on the
 *     engine side). Existing user re-claiming gets free tier.
 *   - Wallet linked + active sub → Case C: standard welcome, restore
 *     the live tier from the existing subscriptions lookup.
 *
 * This route answers the wallet-link question in isolation. Returns
 * `200 { ok: true, walletAddress: string | null, linkedAt: number | null }`.
 * `walletAddress: null` means "no link found"; that is a successful
 * answer, not an error — same contract shape as the subscription
 * lookup's `subscription: null`.
 *
 * Auth: `x-vizzor-bot-token` shared secret via `requireBotSecret`.
 * Rate-limited identically to the subscription lookup so a burst from
 * a bot retry storm doesn't starve other routes.
 *
 * Contract: same `wallet_links` table (`lib/payment/db.ts` schema).
 * `findWalletLinkByTelegramId` is the single read path.
 */

import { NextResponse } from 'next/server';
import { findWalletLinkByTelegramId } from '@/lib/payment/db';
import { requireBotSecret } from '@/lib/payment/bot-auth';
import { enforceRateLimit } from '@/lib/payment/rate-limit';
import { recordAudit } from '@/lib/payment/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function jsonNoStore(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: Request): Promise<NextResponse> {
  const limited = enforceRateLimit(req, 'subscriptions.lookup');
  if (limited) return limited as unknown as NextResponse;

  const auth = requireBotSecret(req);
  if (!auth.ok) {
    recordAudit({
      eventType: 'subscription.lookup',
      actor: 'bot',
      outcome: 'denied',
      req,
    });
    return jsonNoStore({ ok: false, reason: 'unauthorized' }, 401);
  }

  const url = new URL(req.url);
  const rawId = url.searchParams.get('telegram_user_id');
  if (rawId === null || rawId.length === 0) {
    return jsonNoStore({ ok: false, reason: 'invalid_input' }, 400);
  }
  const telegramUserId = Number(rawId);
  if (
    !Number.isFinite(telegramUserId) ||
    !Number.isInteger(telegramUserId) ||
    telegramUserId <= 0
  ) {
    return jsonNoStore({ ok: false, reason: 'invalid_input' }, 400);
  }

  let link;
  try {
    link = findWalletLinkByTelegramId(telegramUserId);
  } catch {
    return jsonNoStore({ ok: false, reason: 'database_error' }, 500);
  }

  recordAudit({
    eventType: 'subscription.lookup',
    actor: 'bot',
    subject: telegramUserId,
    outcome: link ? 'found' : 'not_found',
    req,
  });

  return jsonNoStore(
    {
      ok: true,
      walletAddress: link?.wallet_address ?? null,
      linkedAt: link?.linked_at ?? null,
    },
    200,
  );
}
