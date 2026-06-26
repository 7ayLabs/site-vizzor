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
import {
  getWatcherLastTickAt,
  isWatcherStarted,
} from '@/lib/payment/watcher';
import {
  getTonWatcherLastTickAt,
  isTonWatcherStarted,
} from '@/lib/payment/watcher-ton';
import {
  acceptSolanaPayments,
  acceptTonPayments,
} from '@/lib/feature-flags';
import { poolHealth, type PoolHealth } from '@/lib/payment/address-pool';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const WATCHER_STALE_THRESHOLD_MS = 30_000;
// Engine probe is HEAD-only and cached aggressively — `/api/health` is
// hit by Docker every 30 s, by the deploy smoke 8× per cut, and by the
// in-app status pill every 30 s per active tab. We never want one of
// those to fan out into a real upstream call.
const ENGINE_PROBE_CACHE_MS = 30_000;
const ENGINE_PROBE_TIMEOUT_MS = 2_000;

interface SubsystemStatus {
  ok: boolean;
  detail?: string;
  lastTickAt?: number | null;
  stale?: boolean;
  latencyMs?: number;
  status?: number;
}

interface EngineProbeCache {
  expiresAt: number;
  result: SubsystemStatus;
}
let engineProbeCache: EngineProbeCache | null = null;

function probeSqlite(): SubsystemStatus {
  try {
    const row = getDb().prepare('SELECT 1 AS ok').get() as { ok?: number };
    return { ok: row?.ok === 1 };
  } catch (e) {
    return { ok: false, detail: (e as Error).message.slice(0, 160) };
  }
}

/**
 * Watcher health: report `ok` only when the watcher has booted AND
 * ticked at least once within the last 30s. A watcher that hasn't
 * booted (because Solana payments are disabled at the feature flag)
 * is reported as `ok: true, detail: 'disabled'` — its absence isn't
 * a degradation, it's deliberate.
 */
function probeWatcher(): SubsystemStatus {
  if (!acceptSolanaPayments()) {
    return { ok: true, detail: 'disabled' };
  }
  const started = isWatcherStarted();
  const lastTickAt = getWatcherLastTickAt();
  if (!started) {
    return { ok: true, detail: 'not_started', lastTickAt: null };
  }
  if (lastTickAt === null) {
    // Booted but never returned a successful poll. Could be a slow
    // first tick or a broken RPC; report stale so ops investigates.
    return { ok: false, detail: 'no_ticks_yet', lastTickAt: null, stale: true };
  }
  const stale = Date.now() - lastTickAt > WATCHER_STALE_THRESHOLD_MS;
  return { ok: !stale, lastTickAt, stale };
}

/**
 * Same shape as `probeWatcher` but for the TON daemon. v0.4.0 added
 * `getTonWatcherLastTickAt()` so a stuck TON watcher is now surfaced
 * the same way SOL is — `ok: false, stale: true` when no tick in the
 * last `WATCHER_STALE_THRESHOLD_MS`.
 */
function probeTonWatcher(): SubsystemStatus {
  if (!acceptTonPayments()) {
    return { ok: true, detail: 'disabled' };
  }
  const started = isTonWatcherStarted();
  const lastTickAt = getTonWatcherLastTickAt();
  if (!started) {
    return { ok: true, detail: 'not_started', lastTickAt: null };
  }
  if (lastTickAt === null) {
    return { ok: false, detail: 'no_ticks_yet', lastTickAt: null, stale: true };
  }
  const stale = Date.now() - lastTickAt > WATCHER_STALE_THRESHOLD_MS;
  return { ok: !stale, lastTickAt, stale };
}

/**
 * Per-chain address-pool health. Surfaces the operator-visible
 * lowWatermark flag so a refill alert can be wired to the JSON
 * directly (no Telegram-bot intermediary needed).
 */
function probePool(chain: 'solana' | 'ton'): PoolHealth & { ok: boolean } {
  const health = poolHealth(chain);
  // `ok` reads as "not exhausted" — `lowWatermark` is a softer
  // forewarning, not a fault. Both surface in JSON so the operator
  // can wire either as the alert threshold.
  return { ...health, ok: health.remaining > 0 };
}

/**
 * Engine liveness — HEAD the upstream Vizzor API. Result cached for
 * `ENGINE_PROBE_CACHE_MS` so health checks don't fan out into a real
 * upstream RTT on every poll. Any 2xx/3xx/4xx counts as "reachable"
 * (the engine may not expose `/health`; a 404 from a working server
 * is still proof of life). Only network errors and timeouts mark down.
 */
async function probeEngine(): Promise<SubsystemStatus> {
  const now = Date.now();
  if (engineProbeCache && engineProbeCache.expiresAt > now) {
    return engineProbeCache.result;
  }

  const base =
    process.env.VIZZOR_API_URL ??
    process.env.NEXT_PUBLIC_VIZZOR_API_URL ??
    'https://api.vizzor.ai';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ENGINE_PROBE_TIMEOUT_MS);
  const startedAt = Date.now();
  let result: SubsystemStatus;
  try {
    const res = await fetch(`${base}/`, {
      method: 'HEAD',
      signal: ctrl.signal,
      // Don't send credentials or fancy headers — the probe should not
      // count against any per-key rate budget upstream.
      cache: 'no-store',
    });
    const latencyMs = Date.now() - startedAt;
    // Any HTTP response counts as reachable. 5xx is still "the server
    // answered" — a separate concern from network outage.
    result = {
      ok: res.status < 500,
      status: res.status,
      latencyMs,
      ...(res.status >= 500 ? { detail: `upstream_${res.status}` } : {}),
    };
  } catch (e) {
    const err = e as Error;
    const detail = err.name === 'AbortError' ? 'timeout' : err.message.slice(0, 80);
    result = { ok: false, detail };
  } finally {
    clearTimeout(timer);
  }

  engineProbeCache = {
    expiresAt: now + ENGINE_PROBE_CACHE_MS,
    result,
  };
  return result;
}

export async function GET() {
  const sqlite = probeSqlite();
  const watcher = probeWatcher();
  const tonWatcher = probeTonWatcher();
  const engine = await probeEngine();
  // Address-pool health probes don't gate `status` — a low watermark
  // is an operator-actionable softer alert, not a deploy blocker.
  // Pools surface as their own subsystem keys so an external monitor
  // can wire an alert on `subsystems.solanaPool.lowWatermark`.
  const solanaPool = probePool('solana');
  const tonPool = probePool('ton');
  // Overall `status` reflects "this container can serve traffic" — the
  // deploy smoke-test gates on it (see `.github/workflows/deploy.yml`).
  // Engine reachability and pool low-watermark are reported but NOT
  // folded in: upstream / operator-supply degradations surface to the
  // status pill and the runbook, but shouldn't fail a deploy.
  const allOk = sqlite.ok && watcher.ok && tonWatcher.ok;
  const status: 'healthy' | 'degraded' = allOk ? 'healthy' : 'degraded';

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
        watcher,
        tonWatcher,
        engine,
        solanaPool,
        tonPool,
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
