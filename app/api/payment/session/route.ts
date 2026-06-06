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
import { cookies } from 'next/headers';
import {
  createSession,
  getSession,
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
import {
  COOKIE_NAME,
  COOKIE_TTL_MS,
  DEFAULT_TTL_MS,
  computeIdempotencyKey,
  findRecentSessionByKey,
  mintCookieSessionId,
  recordIdempotencyKey,
} from '@/lib/payment/idempotency';
import { ensureWatcherStarted } from '@/lib/payment/watcher';
import {
  PAYMENT_SESSION_ROUTE_REQUIREMENTS,
  assertRequiredEnv,
} from '@/lib/env';

// Fail fast in production if the payment session route is misconfigured.
// No-op in dev/CI. See lib/env.ts for the declarative requirements bundle.
assertRequiredEnv('payment-session', PAYMENT_SESSION_ROUTE_REQUIREMENTS);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SessionBody {
  tier?: unknown;
  cadence?: unknown;
  chain?: unknown;
  token?: unknown;
}

const VALID_PAIRS = new Set<string>([
  'solana:native',
  'ton:native',
  'base:usdc',
  'arbitrum:usdc',
]);

export async function POST(req: Request) {
  // Lazy boot of the Solana watcher daemon on the first session create.
  // Idempotent — only starts once per Node process, gated by the
  // acceptSolanaPayments() feature flag. TON / EVM watchers ship in
  // a follow-up cycle; until then those chains produce a session but
  // require redemption via the Telegram bot.
  ensureWatcherStarted();

  let body: SessionBody;
  try {
    body = (await req.json()) as SessionBody;
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_body' }, { status: 400 });
  }

  const tier = String(body.tier ?? '');
  const cadence = String(body.cadence ?? '');
  const chain = String(body.chain ?? 'solana');
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

  // Idempotency dedupe (plan §10.7 + scaffolding from b55d306):
  // a 60-second window keyed by (tier, cadence, chain, token,
  // cookieSessionId) collapses double-click / browser-retry into a
  // single payment_sessions row so the polling UI doesn't show a
  // misleading "expired" state on a parallel duplicate.
  const jar = await cookies();
  const existingCookie = jar.get(COOKIE_NAME)?.value;
  const cookieSessionId = existingCookie ?? mintCookieSessionId();
  const idempotencyKey = computeIdempotencyKey({
    tier,
    cadence,
    chain,
    token,
    cookieSessionId,
  });
  const cachedSessionId = findRecentSessionByKey(idempotencyKey, DEFAULT_TTL_MS);
  if (cachedSessionId) {
    const cached = await getSession(cachedSessionId);
    if (cached.ok) {
      return NextResponse.json(
        { ok: true, session: cached.session, idempotent: true },
        attachSessionCookie(cookieSessionId, !existingCookie),
      );
    }
    // Cache hit but the session is gone (expired sweep) — fall
    // through and mint a fresh one. The cache row will get
    // overwritten below.
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
  recordIdempotencyKey(idempotencyKey, result.session.sessionId);
  return NextResponse.json(
    { ok: true, session: result.session },
    attachSessionCookie(cookieSessionId, !existingCookie),
  );
}

function attachSessionCookie(
  cookieSessionId: string,
  setCookie: boolean,
): ResponseInit {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (setCookie) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    headers.append(
      'Set-Cookie',
      `${COOKIE_NAME}=${cookieSessionId}; Path=/; Max-Age=${Math.floor(COOKIE_TTL_MS / 1000)}; HttpOnly; SameSite=Strict${secure}`,
    );
  }
  return { headers };
}
