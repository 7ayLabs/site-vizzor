/**
 * POST /api/auth/mobile-handoff/redeem — one-shot retrieve.
 *
 * Companion to `POST /api/auth/mobile-handoff`. The wallet's redirect
 * brings the user back to `/wallet/callback?hid=<hid>&…`; the callback
 * page POSTs the `hid` here to retrieve the stashed handoff state.
 * The row is deleted in the same transaction so a second redeem (or
 * an attacker who intercepted the URL) cannot replay it.
 *
 * Body:     { hid: string }
 * 200:      { ok: true, state: <opaque object> }
 * 404:      { ok: false, reason: 'not_found' }    — missing OR expired
 * 400:      { ok: false, reason: 'invalid_hid' }   — malformed
 */

import { NextResponse } from 'next/server';
import { checkOrigin } from '@/lib/payment/origin-check';
import { enforceRateLimit } from '@/lib/payment/rate-limit';
import { redeemMobileHandoff } from '@/lib/payment/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HID_PATTERN = /^[a-f0-9]{64}$/;

interface Body {
  hid?: unknown;
}

export async function POST(req: Request) {
  const origin = checkOrigin(req);
  if (!origin.ok) {
    return NextResponse.json(
      { ok: false, reason: origin.reason },
      { status: 403 },
    );
  }
  const limited = enforceRateLimit(req, 'auth.mobile-handoff.redeem');
  if (limited) return limited;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body' },
      { status: 400 },
    );
  }
  const hid = typeof body.hid === 'string' ? body.hid : '';
  if (!HID_PATTERN.test(hid)) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_hid' },
      { status: 400 },
    );
  }

  const row = redeemMobileHandoff(hid);
  if (!row) {
    return NextResponse.json(
      { ok: false, reason: 'not_found' },
      { status: 404 },
    );
  }

  let state: unknown;
  try {
    state = JSON.parse(row.state);
  } catch {
    // Corrupted row — already deleted by the redeem call.
    return NextResponse.json(
      { ok: false, reason: 'corrupted' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, state });
}
