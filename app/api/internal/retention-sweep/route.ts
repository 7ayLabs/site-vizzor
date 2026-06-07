/**
 * POST /api/internal/retention-sweep
 *
 * Daily-cron entrypoint for the data-retention sweep. Authenticated by
 * the bot shared secret (`x-vizzor-bot-token`) — we trust the same
 * boundary as the existing `/api/grants/.../redeem` flow. Triggered
 * from `.github/workflows/snapshot.yml` once per day.
 *
 * Idempotent: running it more often than once a day costs a handful
 * of SQLite reads and changes nothing past steady-state.
 */

import { NextResponse } from 'next/server';
import { requireBotSecret } from '@/lib/payment/bot-auth';
import { enforceRateLimit } from '@/lib/payment/rate-limit';
import { runRetentionSweep } from '@/lib/payment/retention';
import { recordAudit } from '@/lib/payment/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  const limited = enforceRateLimit(req, 'internal.retention-sweep');
  if (limited) return limited as unknown as NextResponse;

  const auth = requireBotSecret(req);
  if (!auth.ok) {
    recordAudit({
      eventType: 'retention.sweep',
      actor: 'bot',
      outcome: 'denied',
      req,
    });
    return NextResponse.json(
      { ok: false, reason: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const result = runRetentionSweep();
    recordAudit({
      eventType: 'retention.sweep',
      actor: 'system',
      outcome: 'ok',
      req,
    });
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    recordAudit({
      eventType: 'retention.sweep',
      actor: 'system',
      outcome: 'error',
      req,
    });
    return NextResponse.json(
      {
        ok: false,
        reason: 'sweep_failed',
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
