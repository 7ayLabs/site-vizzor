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
import { paymentNetwork } from '@/lib/payment/network';
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
import { enforceRateLimit } from '@/lib/payment/rate-limit';
import { checkOrigin } from '@/lib/payment/origin-check';
import {
  PAYMENT_SESSION_ROUTE_REQUIREMENTS,
  missingRequiredEnv,
} from '@/lib/env';

// Env-var requirements are checked at REQUEST time (see handler) so a
// misconfigured prod returns a structured JSON error the UI can show
// the user, instead of throwing at module load and serving a raw
// "Internal Server Error" with no body. The asserting variant still
// runs in the deploy smoke check (CI / startup probe), so a missing
// env is loudly visible to ops without breaking the request path
// when it slips through.

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
  // Outer try/catch — defends against unhandled throws bubbling up as
  // a raw 500. Most failures inside the handler are recoverable
  // (rate-limit, validation, rate-unavailable), but DB write errors
  // and watcher boot throws used to surface as opaque 500 to the
  // checkout UI ("Something went wrong"). Catching here lets us log
  // the actual cause and return a structured `internal_error` the
  // client surfaces with a clear retry path.
  try {
    // Runtime env check — surfaced as 503 + structured reason so the
    // UI can render a real message ("payment service is being
    // configured: VIZZOR_SOLANA_TREASURY") instead of a generic
    // retry chip. Loud signal to ops via the `missing` array.
    const missingEnv = missingRequiredEnv(PAYMENT_SESSION_ROUTE_REQUIREMENTS);
    if (process.env.NODE_ENV === 'production' && missingEnv.length > 0) {
      const names = missingEnv.map((m) => m.name);
      console.error(
        '[vizzor-payment] route misconfigured — missing env:',
        names.join(', '),
      );
      return NextResponse.json(
        {
          ok: false,
          reason: 'payment_misconfigured',
          message: `Payment service is being configured. Missing: ${names.join(', ')}.`,
          missing: names,
        },
        { status: 503 },
      );
    }

    const origin = checkOrigin(req);
    if (!origin.ok) {
      return NextResponse.json(
        { ok: false, reason: origin.reason },
        { status: 403 },
      );
    }
    const limited = enforceRateLimit(req, 'payment.session');
    if (limited) return limited;

    // Lazy boot of the Solana watcher daemon on the first session
    // create. Idempotent — only starts once per Node process. Wrapped
    // in its own try/catch so a watcher boot failure (missing RPC,
    // bad treasury format) doesn't block sessions on the chain the
    // user isn't even paying with. We log + continue: the watcher
    // will retry on the next session create, and TON sessions don't
    // need the Solana watcher at all.
    try {
      ensureWatcherStarted();
    } catch (watcherErr) {
      console.error(
        '[vizzor-payment] watcher boot failed (continuing):',
        (watcherErr as Error)?.message ?? watcherErr,
      );
    }

    let body: SessionBody;
    try {
      body = (await req.json()) as SessionBody;
    } catch {
      return NextResponse.json(
        { ok: false, reason: 'invalid_body' },
        { status: 400 },
      );
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
    const cachedSessionId = findRecentSessionByKey(
      idempotencyKey,
      DEFAULT_TTL_MS,
    );
    if (cachedSessionId) {
      const cached = await getSession(cachedSessionId);
      if (cached.ok) {
        return NextResponse.json(
          {
            ok: true,
            session: cached.session,
            network: paymentNetwork(),
            idempotent: true,
          },
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
      { ok: true, session: result.session, network: paymentNetwork() },
      attachSessionCookie(cookieSessionId, !existingCookie),
    );
  } catch (err) {
    // Log the actual stack so ops can diagnose from container logs.
    // Common causes that land here: SQLite write failure (read-only
    // mount, missing migration), treasury address format error, RPC
    // unreachable + creating a Connection that throws on init.
    console.error('[vizzor-payment] session create threw:', err);
    return NextResponse.json(
      {
        ok: false,
        reason: 'internal_error',
        message: (err as Error)?.message ?? 'unexpected_failure',
      },
      { status: 500 },
    );
  }
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
