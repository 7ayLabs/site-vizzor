/**
 * POST /api/cli-pair/mint
 *
 * Last step of the CLI pair flow. The operator has already signed SIWS on
 * the `/cli-pair` page (cookie session is hot); this endpoint:
 *
 *   1. Verifies an active SIWS session exists. If none, 401.
 *   2. Resolves the operator's effective tier (Free / Pro / Elite) via
 *      the existing `resolveTier()` helper. Trial wallets surface as Pro
 *      so the CLI gets the same paid breadth the web app would give.
 *   3. Mints a `vizzor_auth_v1` token tied to the session wallet, signed
 *      with VIZZOR_AUTH_SECRET so the engine + CLI both verify it.
 *   4. Returns the token JSON-shaped so the page can render a copyable
 *      code block.
 *
 * The minted token has a 60-minute default lifetime. The CLI persists
 * it to ~/.vizzor/auth.json and re-pairs when it expires.
 */

import { getActiveSession } from '@/lib/payment/auth-session';
import { resolveTier, type EffectiveTier } from '@/lib/payment/tier-resolver';
import { signVizzorAuthToken } from '@/lib/payment/vizzor-auth';
import type { VizzorTier } from '@/lib/payment/vizzor-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_TTL_MINUTES = 60;
const MAX_TTL_MINUTES = 24 * 60;

interface MintRequestBody {
  ttlMinutes?: number;
}

export async function POST(req: Request): Promise<Response> {
  const session = await getActiveSession();
  if (!session) {
    return Response.json(
      { error: 'auth_required', message: 'Sign in with your wallet first.' },
      { status: 401 },
    );
  }

  const secret = process.env.VIZZOR_AUTH_SECRET;
  if (!secret || secret.length < 16) {
    return Response.json(
      {
        error: 'server_misconfigured',
        message:
          'VIZZOR_AUTH_SECRET is not set on the host. Configure it in the site env to enable CLI pairing.',
      },
      { status: 500 },
    );
  }

  let body: MintRequestBody;
  try {
    body = (await req.json().catch(() => ({}))) as MintRequestBody;
  } catch {
    body = {};
  }

  const ttlRaw = Number(body.ttlMinutes ?? DEFAULT_TTL_MINUTES);
  const ttlMinutes = Number.isFinite(ttlRaw) && ttlRaw > 0 ? Math.min(ttlRaw, MAX_TTL_MINUTES) : DEFAULT_TTL_MINUTES;

  const effective = resolveTier(session.wallet);
  const tier = effectiveTierToVizzorTier(effective);

  const now = Math.floor(Date.now() / 1000);
  const token = signVizzorAuthToken(
    {
      wallet: session.wallet,
      tier,
      iat: now,
      exp: now + ttlMinutes * 60,
    },
    secret,
  );

  return Response.json({
    token,
    walletAddress: session.wallet,
    tier,
    expiresAt: now + ttlMinutes * 60,
    pairedAt: Date.now(),
  });
}

/**
 * The site's EffectiveTier carries `'pro' | 'elite' | 'free'` but the
 * engine token allows `'free' | 'trial' | 'pro' | 'elite' | 'lifetime'`.
 * Map the site shape into the wider engine shape so the engine's PBAC
 * decisions match what the user pays for.
 */
function effectiveTierToVizzorTier(effective: EffectiveTier): VizzorTier {
  if (effective.kind === 'elite') {
    // The site folds Lifetime into Elite (no separate 'lifetime' kind),
    // but the engine treats them as the same entitlements anyway, so
    // mapping to 'elite' is correct.
    return 'elite';
  }
  if (effective.kind === 'pro') return 'pro';
  // Free + everything else.
  return 'free';
}
