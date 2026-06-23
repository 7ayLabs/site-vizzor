/**
 * POST /api/subscriptions/downgrade — schedule the active Elite
 * subscription to land at Pro (rather than Free) when the current
 * period ends.
 *
 * Like /cancel, this is purely a UX-layer scheduling marker. The
 * tier resolver doesn't consult `scheduled_action`; the underlying
 * lifecycle is unchanged — the Elite subscription rides until
 * `expires_at` and lapses to free as usual. The marker just lets
 * /account show "Elite continues until {date}, then drops to Pro"
 * and primes the next subscribe CTA toward the Pro tier instead of
 * the recently-active Elite tier.
 *
 * No money moves; no in-period switch; no refund. The actual Pro
 * subscription is created when the user posts a fresh Pro payment
 * session after the Elite period elapses.
 *
 * Authenticated by the SIWS auth-session cookie. Origin-checked +
 * rate-limited the same way /api/subscriptions/cancel is.
 *
 * Edge cases:
 *   - No active subscription          → 404 `no_active_subscription`.
 *   - Active subscription is Pro      → 422 `not_an_elite_subscription`
 *                                        (downgrade is Elite-only;
 *                                        cancelling Pro is /cancel).
 *   - Lifetime (Elite or otherwise)   → 422 `lifetime_cannot_change`
 *                                        (non-refundable by policy).
 *   - Already scheduled to downgrade  → idempotent 200; no-op write.
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
  const limited = enforceRateLimit(req, 'subscription.downgrade');
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
      eventType: 'subscription.downgrade',
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

  // Lifetime non-refundable, no expires_at to schedule against.
  if (current.expires_at === null || current.cadence === 'lifetime') {
    recordAudit({
      eventType: 'subscription.downgrade',
      actor: actorFromWallet(wallet),
      subject: wallet,
      outcome: 'denied',
      req,
    });
    return NextResponse.json(
      { ok: false, reason: 'lifetime_cannot_change' },
      { status: 422, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Downgrade is Elite-only. Pro → Free is the /cancel route.
  if (current.tier !== 'elite') {
    recordAudit({
      eventType: 'subscription.downgrade',
      actor: actorFromWallet(wallet),
      subject: wallet,
      outcome: 'denied',
      req,
    });
    return NextResponse.json(
      { ok: false, reason: 'not_an_elite_subscription' },
      { status: 422, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const updated = setScheduledActionForActiveSubscription(
    wallet,
    'downgrade_to_pro',
    now,
  );

  recordAudit({
    eventType: 'subscription.downgrade',
    actor: actorFromWallet(wallet),
    subject: wallet,
    outcome: 'ok',
    req,
  });

  return NextResponse.json(
    {
      ok: true,
      scheduledAction: 'downgrade_to_pro' as const,
      tier: updated?.tier ?? current.tier,
      cadence: updated?.cadence ?? current.cadence,
      expiresAt: updated?.expires_at ?? current.expires_at,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
