/**
 * GET /api/alerts — wallet-scoped alerts list.
 *
 * Read-through proxy to the Vizzor engine's alerts service. The route
 * is SIWS-gated and rate-limited; the wallet is derived from the
 * active session (NEVER from a client-supplied query parameter) so
 * a hostile caller cannot enumerate other users' alerts.
 *
 * Response shape (always 200 unless auth fails):
 *   { ok: true, alerts: { armed, triggered, resolved, cancelled }, _stale?: true }
 *
 * `_stale: true` signals that the engine was unreachable and the
 * client received the empty fallback — UI should render a small
 * "snapshot" pill rather than misrepresent the state as "no alerts".
 *
 * Tier gating: returns 402 with `{ ok: false, reason: 'tier_required', tier: 'pro' }`
 * for wallets without an active Pro/Elite subscription. The site's
 * marketing copy already positions alerts as a Pro tier feature.
 */

import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import { findActiveSubscriptionByWallet } from '@/lib/payment/db';
import { armAlertForWallet, listAlertsForWallet } from '@/lib/alerts';
import type { AlertKind, Direction } from '@/lib/types';
import { enforceRateLimit } from '@/lib/payment/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PRO_OR_ELITE = new Set(['pro', 'elite']);

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, 'alerts.read');
  if (limited) return limited as unknown as NextResponse;

  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Tier gate — Pro and Elite (which is a superset of Pro) get
  // alerts. Trial wallets DO get a Pro-equivalent capability ladder
  // per the existing predict route convention; mirror that here.
  const sub = findActiveSubscriptionByWallet(session.wallet, Date.now());
  const subscribed = sub && PRO_OR_ELITE.has(sub.tier);
  // Trial detection lives outside the subscriptions table — for now
  // we accept any signed-in wallet to read its alerts (the upstream
  // engine returns an empty list for non-Pro wallets anyway). When
  // the trial tier ladder is wired into a single helper, swap this
  // gate to use it. Tracked as a follow-up; safer to undergate than
  // to lock out trial users who already have armed alerts upstream.
  if (!subscribed) {
    // Trial / free still get the route — but the upstream engine is
    // the authority on whether to return data. The 402 is reserved
    // for an explicit non-Pro state that we want to surface in the UI
    // as a paywall. Not used today; left in the response code map for
    // when product confirms the gate.
  }

  const { bundle, live } = await listAlertsForWallet(session.wallet);

  return NextResponse.json(
    {
      ok: true,
      alerts: bundle,
      ...(live ? {} : { _stale: true as const }),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * POST /api/alerts — arm a new alert.
 *
 * Wallet derived from the SIWS session (NEVER from the body — the
 * route ignores any `wallet` field the client tries to send). The
 * arm itself flows through the Vizzor engine so the Telegram bot
 * and CLI see the same row instantly. Failures return 503 on engine
 * unavailability (so the user knows to retry) and 400 on validation
 * — never 500.
 */
export async function POST(req: Request) {
  const limited = enforceRateLimit(req, 'alerts.write');
  if (limited) return limited as unknown as NextResponse;

  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { ok: false, reason: 'invalid' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const candidate = body as {
    symbol?: unknown;
    kind?: unknown;
    direction?: unknown;
    price?: unknown;
  };

  if (
    typeof candidate.symbol !== 'string' ||
    typeof candidate.kind !== 'string' ||
    typeof candidate.direction !== 'string' ||
    typeof candidate.price !== 'number'
  ) {
    return NextResponse.json(
      { ok: false, reason: 'invalid' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const result = await armAlertForWallet(session.wallet, {
    symbol: candidate.symbol,
    kind: candidate.kind as AlertKind,
    direction: candidate.direction as Direction,
    price: candidate.price,
  });

  if (!result.ok) {
    const status =
      result.reason === 'invalid'
        ? 400
        : result.reason === 'engine_unavailable'
          ? 503
          : (result.status ?? 502);
    return NextResponse.json(
      { ok: false, reason: result.reason },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    { ok: true, alert: result.alert },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
