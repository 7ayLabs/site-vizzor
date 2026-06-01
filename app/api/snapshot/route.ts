/**
 * Build-time snapshot refresh endpoint.
 *
 * The GitHub Action at `.github/workflows/snapshot.yml` calls this route on a
 * cron (default hourly), captures the JSON response, writes it to
 * `data/snapshot.json`, commits if the content changed, and triggers a
 * redeploy. This keeps the site's snapshot fallback fresh without making
 * every page request hit the live API.
 *
 * The route itself just proxies the live API. If the API is unreachable, it
 * returns the existing committed snapshot — the cron workflow then sees no
 * delta and skips the redeploy. Visitors never see a broken page.
 */

import { NextResponse } from 'next/server';
import { getSnapshot } from '@/lib/snapshot';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const API_BASE =
  process.env.VIZZOR_API_URL ??
  process.env.NEXT_PUBLIC_VIZZOR_API_URL ??
  'https://api.vizzor.ai';

const FETCH_TIMEOUT_MS = 8_000;

async function safeFetch<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const [ticker, trackerWR, recent] = await Promise.all([
    safeFetch(`${API_BASE}/v1/site/ticker`),
    safeFetch(`${API_BASE}/v1/site/tracker-wr`),
    safeFetch(`${API_BASE}/v1/site/recent-predictions?limit=20`),
  ]);

  // If any pull failed, return the existing committed snapshot — the
  // GitHub Action will diff and skip the commit/redeploy.
  if (!ticker || !trackerWR || !recent) {
    const snap = getSnapshot();
    return NextResponse.json({ ...snap, _stale: true }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const current = getSnapshot();

  return NextResponse.json(
    {
      _seed: false,
      asOf: new Date().toISOString(),
      calibrationBanner: current.calibrationBanner,
      ticker,
      trackerWR,
      recentPredictions: recent,
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
