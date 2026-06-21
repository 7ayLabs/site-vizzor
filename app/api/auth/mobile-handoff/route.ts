/**
 * POST /api/auth/mobile-handoff — create a server-side handoff row.
 *
 * The mobile Connect-Protocol flow needs the dapp's per-attempt
 * X25519 secret key to decrypt the wallet's encrypted response when
 * the user returns. Browser `localStorage` would work in theory, but
 * iOS Brave + Safari frequently land the wallet's universal-link
 * redirect in a NEW WKWebView process pool whose per-origin storage
 * is empty — the secret key is gone and the callback page surfaces
 * `VZ-WAL-011 mobile-handoff-missing`.
 *
 * Persisting the state server-side keyed by a 32-byte random `id`
 * the client embeds in the redirect URL eliminates that whole class
 * of browser quirk. The row is one-shot (deleted on first read by
 * the companion `/redeem` endpoint) and TTL-bounded so abandoned
 * attempts can't be replayed.
 *
 * Body:    { state: <opaque JSON-stringifiable object> }
 * Success: 201 { hid: <32-byte hex> }   (caller uses this in the
 *           wallet's `redirect_link` URL query string).
 */

import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { checkOrigin } from '@/lib/payment/origin-check';
import { enforceRateLimit } from '@/lib/payment/rate-limit';
import { insertMobileHandoff } from '@/lib/payment/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Same 5-minute window we use for the SIWS nonce — the X25519
 *  keypair this state holds is only useful for that window anyway. */
const HANDOFF_TTL_MS = 5 * 60 * 1000;

interface Body {
  state?: unknown;
}

export async function POST(req: Request) {
  const origin = checkOrigin(req);
  if (!origin.ok) {
    return NextResponse.json(
      { ok: false, reason: origin.reason },
      { status: 403 },
    );
  }
  const limited = enforceRateLimit(req, 'auth.mobile-handoff.create');
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
  if (!body.state || typeof body.state !== 'object') {
    return NextResponse.json(
      { ok: false, reason: 'invalid_state' },
      { status: 400 },
    );
  }

  let stateJson: string;
  try {
    stateJson = JSON.stringify(body.state);
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_state' },
      { status: 400 },
    );
  }
  // Guardrail: the handoff payload is meant for a single X25519 keypair
  // + a handful of small string fields. Anything larger than a few KB
  // would be abuse — refuse before we touch SQLite.
  if (stateJson.length > 8 * 1024) {
    return NextResponse.json(
      { ok: false, reason: 'state_too_large' },
      { status: 413 },
    );
  }

  const hid = randomBytes(32).toString('hex');
  insertMobileHandoff({
    id: hid,
    state: stateJson,
    expiresAt: Date.now() + HANDOFF_TTL_MS,
  });

  return NextResponse.json({ ok: true, hid }, { status: 201 });
}
