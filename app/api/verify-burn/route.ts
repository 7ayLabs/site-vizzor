/**
 * POST /api/verify-burn — confirms a Solana SPL transfer to the
 * $VIZZOR incinerator.
 *
 * The route is separate from `/api/predict` so it can be:
 *   - tested in isolation (unit tests against a known sig + RPC)
 *   - called by other surfaces in the future (e.g. a Discord bot)
 *
 * Body: { signature: string }
 * Returns: { ok: true } on a valid, fresh, sufficient burn,
 *          { ok: false, reason: <enum> } otherwise.
 *
 * This route is itself called server-to-server by /api/predict when
 * the `x-vizzor-burn-tx` header is present and the token is live.
 */

import { isTokenLive } from '@/lib/feature-flags';
import { verifyBurnTx } from '@/lib/solana-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface VerifyBody {
  signature?: unknown;
}

export async function POST(req: Request) {
  if (!isTokenLive()) {
    return Response.json(
      { ok: false, reason: 'token_not_live' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let body: VerifyBody;
  try {
    body = (await req.json()) as VerifyBody;
  } catch {
    return Response.json({ ok: false, reason: 'invalid_body' }, { status: 400 });
  }

  const sig = body.signature;
  if (typeof sig !== 'string' || sig.length === 0) {
    return Response.json(
      { ok: false, reason: 'missing_signature' },
      { status: 400 },
    );
  }

  const result = await verifyBurnTx(sig);
  return Response.json(result, {
    status: result.ok ? 200 : 402,
    headers: { 'Cache-Control': 'no-store' },
  });
}
