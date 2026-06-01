/**
 * POST /api/payment/session — create a payment session.
 *
 * Body: { tier, cadence, chain }
 *
 * The site validates tier+cadence+chain locally (cheap input gate),
 * looks up the canonical USD price in `pricing-table.ts`, then proxies
 * to the engine which derives a unique HD destination address, locks
 * the USD-to-TON rate, and persists the session record. The engine is
 * the source of truth — site-side price is just a guard.
 *
 * Returns the engine's session object verbatim on success. On feature-
 * flag off or engine offline: 503 with a `reason` enum so the UI can
 * render a clear "payment infrastructure pending" state instead of
 * fabricating a destination address.
 */

import { NextResponse } from 'next/server';
import {
  createSession,
  type PaymentCadence,
  type PaymentChain,
  type PaymentTier,
} from '@/lib/payment/session';
import { isValidCombo, priceCents } from '@/lib/payment/pricing-table';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SessionBody {
  tier?: unknown;
  cadence?: unknown;
  chain?: unknown;
}

export async function POST(req: Request) {
  let body: SessionBody;
  try {
    body = (await req.json()) as SessionBody;
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_body' }, { status: 400 });
  }

  const tier = String(body.tier ?? '');
  const cadence = String(body.cadence ?? '');
  const chain = String(body.chain ?? '');

  if (!isValidCombo(tier, cadence)) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_tier_cadence' },
      { status: 400 },
    );
  }
  if (chain !== 'ton') {
    return NextResponse.json(
      { ok: false, reason: 'unsupported_chain' },
      { status: 400 },
    );
  }

  const amountUsdCents = priceCents(
    tier as PaymentTier,
    cadence as PaymentCadence,
  );
  if (amountUsdCents === null) {
    return NextResponse.json(
      { ok: false, reason: 'price_lookup_failed' },
      { status: 500 },
    );
  }

  const result = await createSession({
    tier: tier as PaymentTier,
    cadence: cadence as PaymentCadence,
    chain: chain as PaymentChain,
    amountUsdCents,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason },
      { status: result.reason === 'invalid_input' ? 400 : 503 },
    );
  }
  return NextResponse.json(
    { ok: true, session: result.session },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
