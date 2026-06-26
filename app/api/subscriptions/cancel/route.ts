/**
 * POST /api/subscriptions/cancel — schedule the active subscription
 * to end at the current period boundary instead of being implicitly
 * carried over by a new payment.
 *
 * Vizzor has no auto-renewal — every subscription is paid upfront for
 * a fixed period (monthly / annual / lifetime) and lapses to free at
 * `expires_at` unless the wallet posts another payment session. So
 * "cancel" is the explicit version of that lapse: the wallet's UI
 * surface stops nudging "renew now", the lifetime promo pill hides,
 * and /account renders a "plan continues until {date}, then drops to
 * Free" banner. No money moves; no refund is issued.
 *
 * Authenticated by the SIWS auth-session cookie — only the wallet
 * that owns the subscription can cancel it. Origin-checked and
 * rate-limited the same way /api/account/delete is.
 *
 * Response: `{ ok: true, scheduledAction: 'cancel', tier, cadence,
 *             expiresAt }` so the caller can re-render without a
 * separate /api/quota refetch.
 *
 * Edge cases:
 *   - No active subscription → 404 `no_active_subscription`.
 *   - Lifetime tier → 422 `lifetime_cannot_cancel` (lifetime has no
 *     expiry to schedule against; product-policy non-refundable).
 *   - Already cancelled → idempotent 200; row write is a no-op.
 *   - Operator wants to un-cancel before expires_at → not supported
 *     yet (intentional; the use-case is rare and the UX risk of
 *     "phantom subscription" outweighs the convenience).
 */

import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import { enforceRateLimit } from '@/lib/payment/rate-limit';
import { checkOrigin } from '@/lib/payment/origin-check';
import { recordAudit, actorFromWallet } from '@/lib/payment/audit';
import {
  findActiveSubscriptionByWallet,
  setScheduledActionForActiveSubscription,
} from '@/lib/payment/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  const origin = checkOrigin(req);
  if (!origin.ok) {
    return NextResponse.json(
      { ok: false, reason: origin.reason },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const limited = enforceRateLimit(req, 'subscription.cancel');
  if (limited) return limited as unknown as NextResponse;

  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const wallet = session.wallet;
  const now = Date.now();
  const current = findActiveSubscriptionByWallet(wallet, now);

  if (!current) {
    recordAudit({
      eventType: 'subscription.cancel',
      actor: actorFromWallet(wallet),
      subject: wallet,
      outcome: 'not_found',
      req,
    });
    return NextResponse.json(
      { ok: false, reason: 'no_active_subscription' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Lifetime has no expires_at — there's nothing to schedule against,
  // and the product policy is non-refundable. Refuse with a clear
  // reason so the UI can surface the right copy.
  if (current.expires_at === null || current.cadence === 'lifetime') {
    recordAudit({
      eventType: 'subscription.cancel',
      actor: actorFromWallet(wallet),
      subject: wallet,
      outcome: 'denied',
      req,
    });
    return NextResponse.json(
      { ok: false, reason: 'lifetime_cannot_cancel' },
      { status: 422, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const updated = setScheduledActionForActiveSubscription(
    wallet,
    'cancel',
    now,
  );

  recordAudit({
    eventType: 'subscription.cancel',
    actor: actorFromWallet(wallet),
    subject: wallet,
    outcome: 'ok',
    req,
  });

  return NextResponse.json(
    {
      ok: true,
      scheduledAction: 'cancel' as const,
      tier: updated?.tier ?? current.tier,
      cadence: updated?.cadence ?? current.cadence,
      expiresAt: updated?.expires_at ?? current.expires_at,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
