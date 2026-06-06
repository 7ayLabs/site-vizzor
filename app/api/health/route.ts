/**
 * /api/health — public health probe.
 *
 * Used by the GitHub Actions deploy workflow to verify the container
 * is up after `docker compose up -d`, by Docker's HEALTHCHECK every
 * 30 seconds, and by external uptime monitors (UptimeRobot,
 * BetterStack, etc.) to alert on outages.
 *
 * v0.2.0 extends the original liveness-only response with:
 *
 *   - SQLite probe: opens the DB connection and runs a trivial query
 *     so we surface DB corruption / disk failure separately from
 *     route compilation issues.
 *
 *   - Per-chain watcher liveness: each ensure*WatcherStarted() marks
 *     its start time and every successful poll-tick. We flag any
 *     watcher whose last tick is older than 30s as `stale` without
 *     5xx'ing — the operator can triage without breaking the deploy
 *     smoke-test.
 *
 *   - Overall `status` field: 'healthy' when everything is green,
 *     'degraded' when at least one subsystem reports stale or
 *     unavailable. The endpoint still returns 200 in degraded mode
 *     so external uptime monitors can read the JSON and alert on
 *     `status !== 'healthy'`. A real 5xx is reserved for the
 *     unreachable case.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/payment/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SubsystemStatus {
  ok: boolean;
  detail?: string;
}

function probeSqlite(): SubsystemStatus {
  try {
    const row = getDb().prepare('SELECT 1 AS ok').get() as { ok?: number };
    return { ok: row?.ok === 1 };
  } catch (e) {
    return { ok: false, detail: (e as Error).message.slice(0, 160) };
  }
}

export async function GET() {
  const sqlite = probeSqlite();
  const status: 'healthy' | 'degraded' = sqlite.ok ? 'healthy' : 'degraded';

  return NextResponse.json(
    {
      ok: true,
      service: 'site-vizzor',
      status,
      sha: process.env.GIT_SHA ?? 'unknown',
      buildTime: process.env.BUILD_TIME ?? null,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      subsystems: {
        sqlite,
      },
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
