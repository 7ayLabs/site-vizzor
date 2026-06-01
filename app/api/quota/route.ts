/**
 * GET /api/quota — current free-tier state for the active browser.
 *
 * Returns `{ used, limit, remaining, exhausted, isLive }` so the chat
 * sidebar can render the right state (free / paywall / wallet) without
 * also reading the HttpOnly quota cookie directly.
 *
 * `isLive` echoes the `NEXT_PUBLIC_TOKEN_LIVE` flag so the sidebar
 * knows whether to surface "connect wallet" or "launching soon".
 */

import { NextResponse } from 'next/server';
import { readQuota } from '@/lib/quota';
import { isTokenLive } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const quota = await readQuota();
  return NextResponse.json(
    { ...quota, isLive: isTokenLive() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
