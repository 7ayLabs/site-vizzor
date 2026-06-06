/**
 * POST /api/payment/session — create a payment session.
 *
 * Body: { tier, cadence, chain, token }
 *
 * The site validates tier+cadence+(chain,token) locally, looks up the
 * canonical USD price + applicable discount in `pricing-table.ts`, then
 * proxies to the engine which derives a unique destination address,
 * locks the USD-to-token rate, validates the discount math, and persists
 * the session record. The engine is the source of truth — site-side
 * price+discount are guards.
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
  type PaymentToken,
} from '@/lib/payment/session';
import {
  discountBps,
  effectivePriceCents,
  isValidCombo,
} from '@/lib/payment/pricing-table';
import { ensureWatcherStarted } from '@/lib/payment/watcher';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SessionBody {
  tier?: unknown;
  cadence?: unknown;
  chain?: unknown;
  token?: unknown;
}

const VALID_PAIRS = new Set<string>([
  'ton:native',
  'solana:vizzor',
]);

export async function POST(req: Request) {
  // Lazy boot of the on-chain watcher daemon on the first session
  // create. Idempotent — only starts once per Node process.
  ensureWatcherStarted();

  let body: SessionBody;
  try {
    body = (await req.json()) as SessionBody;
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_body' }, { status: 400 });
  }

  const tier = String(body.tier ?? '');
  const cadence = String(body.cadence ?? '');
  const chain = String(body.chain ?? 'ton');
  const token = String(body.token ?? 'native');

  if (!isValidCombo(tier, cadence)) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_tier_cadence' },
      { status: 400 },
    );
  }
  if (!VALID_PAIRS.has(`${chain}:${token}`)) {
    return NextResponse.json(
      { ok: false, reason: 'unsupported_chain' },
      { status: 400 },
    );
  }

  const amountUsdCents = effectivePriceCents(
    tier as PaymentTier,
    cadence as PaymentCadence,
    chain as PaymentChain,
    token as PaymentToken,
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
    token: token as PaymentToken,
    amountUsdCents: Math.round(amountUsdCents),
    discountBps: discountBps(
      tier as PaymentTier,
      cadence as PaymentCadence,
      chain as PaymentChain,
      token as PaymentToken,
    ),
  });

  if (!result.ok) {
    const status =
      result.reason === 'invalid_input'
        ? 400
        : result.reason === 'rate_unavailable'
          ? 503
          : 503;
    return NextResponse.json(
      { ok: false, reason: result.reason },
      { status },
    );
  }
  return NextResponse.json(
    { ok: true, session: result.session },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
