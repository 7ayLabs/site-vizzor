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

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, 'directory.read');
  if (limited) return limited as unknown as NextResponse;

  const session = await getActiveSession();
  const wallet = session?.wallet ?? null;
  const catalog = loadCatalog();
  const entries = getHydratedCatalog(wallet);

  return NextResponse.json(
    {
      ok: true,
      version: catalog.version,
      generated_at: catalog.generated_at,
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
