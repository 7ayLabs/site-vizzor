/**
 * /api/health — public health probe.
 *
 * Used by the GitHub Actions deploy workflow to verify the container is up
 * after `docker compose up -d`, and by external uptime monitors
 * (UptimeRobot, BetterStack, etc.) to alert on outages.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: 'site-vizzor',
      sha: process.env.GIT_SHA ?? 'unknown',
      buildTime: process.env.BUILD_TIME ?? null,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}
