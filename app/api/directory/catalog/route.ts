/**
 * GET /api/directory/catalog — the catalog the Directory UI renders.
 *
 * Merges the static `data/connectors.json` with the caller's install
 * state (if signed in) so the UI can render `Installed` pills and
 * `Active skill` indicators in a single round-trip.
 *
 * Anonymous calls receive every entry with `installed: false` and
 * `active_skill: false` — browsing and searching the directory does
 * not require auth. The route is rate-limited per IP regardless.
 */

import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import { enforceRateLimit } from '@/lib/payment/rate-limit';
import { getHydratedCatalog } from '@/lib/directory/runtime';
import { loadCatalog } from '@/lib/directory/catalog';
import { resolveTier } from '@/lib/payment/tier-resolver';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, 'directory.read');
  if (limited) return limited as unknown as NextResponse;

  const session = await getActiveSession();
  const wallet = session?.wallet ?? null;
  // Resolve the caller's effective tier so the catalog can surface a
  // `locked` flag per entry. Anonymous browsers get null tier so only
  // required_tier === 'free' entries are unlocked in the UI — paid
  // surfaces show as locked behind a sign-in prompt.
  const effective = wallet ? resolveTier(wallet) : null;
  const catalog = loadCatalog();
  const entries = getHydratedCatalog(wallet, effective);

  return NextResponse.json(
    {
      ok: true,
      version: catalog.version,
      generated_at: catalog.generated_at,
      caller_tier: effective?.kind ?? null,
      entries,
    },
    {
      headers: {
        'Cache-Control': wallet
          ? 'private, max-age=0, no-store'
          : 'public, max-age=60, stale-while-revalidate=300',
      },
    },
  );
}
