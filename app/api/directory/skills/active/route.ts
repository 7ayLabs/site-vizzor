/**
 * GET /api/directory/skills/active — current active skill for the wallet.
 * PATCH                            — set or clear the active skill.
 *
 * The active skill ID is forwarded to the engine on every predict
 * request as `skill_id`. PATCH body `{ skill_id: string | null }`;
 * passing null clears the selection so the engine falls back to
 * default reasoning.
 */

import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import { enforceRateLimit } from '@/lib/payment/rate-limit';
import { recordAudit, actorFromWallet } from '@/lib/payment/audit';
import { isKnownSkill } from '@/lib/directory/catalog';
import {
  getWalletPreferences,
  setActiveSkillForWallet,
} from '@/lib/payment/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, 'directory.read');
  if (limited) return limited as unknown as NextResponse;

  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401 },
    );
  }
  const prefs = getWalletPreferences(session.wallet);
  return NextResponse.json(
    { ok: true, skill_id: prefs?.active_skill_id ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function PATCH(req: Request) {
  const limited = enforceRateLimit(req, 'directory.write');
  if (limited) return limited as unknown as NextResponse;

  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401 },
    );
  }

  let body: { skill_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body' },
      { status: 400 },
    );
  }

  const skillId = body.skill_id;
  if (skillId !== null && typeof skillId !== 'string') {
    return NextResponse.json(
      { ok: false, reason: 'invalid_skill_id' },
      { status: 400 },
    );
  }
  if (typeof skillId === 'string' && !isKnownSkill(skillId)) {
    return NextResponse.json(
      { ok: false, reason: 'unknown_skill' },
      { status: 400 },
    );
  }

  setActiveSkillForWallet(session.wallet, skillId);
  recordAudit({
    eventType: 'directory.skill.activated',
    actor: actorFromWallet(session.wallet),
    subject: skillId ?? 'none',
    outcome: 'ok',
    req,
  });
  return NextResponse.json({ ok: true });
}
