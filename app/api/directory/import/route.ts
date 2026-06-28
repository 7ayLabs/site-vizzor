/**
 * POST /api/directory/import — apply a saved directory profile.
 *
 * Body is an export from `/api/directory/export`. Behavior:
 *
 *   - active_skill_id, when present + still in the catalog + the
 *     caller's tier allows it, becomes the wallet's new active skill.
 *     Otherwise skipped silently and reported in the response.
 *   - installs (connector + plugin ids) are NOT auto-installed —
 *     credentials live encrypted per-wallet and can't be ported. We
 *     return a `to_install` list so the UI can prompt the user to
 *     re-credential each one with a single click per entry.
 *
 * Idempotent: importing the same export twice is a no-op (the second
 * skill set matches what's already there; the to_install list is the
 * same shape).
 */

import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import { enforceRateLimit } from '@/lib/payment/rate-limit';
import { recordAudit, actorFromWallet } from '@/lib/payment/audit';
import { getEntry } from '@/lib/directory/catalog';
import {
  getInstalledForWallet,
  tierGateForEntry,
} from '@/lib/directory/runtime';
import {
  setActiveSkillForWallet,
} from '@/lib/payment/db';
import { resolveTier } from '@/lib/payment/tier-resolver';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ImportInstall {
  connector_id: string;
}

interface ImportBody {
  version?: number;
  active_skill_id?: string | null;
  installs?: ImportInstall[];
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, 'directory.write');
  if (limited) return limited as unknown as NextResponse;

  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401 },
    );
  }

  let body: ImportBody;
  try {
    body = (await req.json()) as ImportBody;
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body' },
      { status: 400 },
    );
  }
  if (body.version !== 1) {
    return NextResponse.json(
      { ok: false, reason: 'unsupported_version' },
      { status: 400 },
    );
  }

  const effective = resolveTier(session.wallet);
  const result = {
    skill_applied: null as string | null,
    skill_skipped_reason: null as 'unknown_skill' | 'tier_required' | null,
    to_install: [] as Array<{
      connector_id: string;
      reason: 'not_in_catalog' | 'tier_required' | 'already_installed' | 'ready';
    }>,
  };

  // ── Skill activation ─────────────────────────────────────────────
  if (typeof body.active_skill_id === 'string' && body.active_skill_id) {
    const entry = getEntry(body.active_skill_id);
    if (!entry || entry.category !== 'skill') {
      result.skill_skipped_reason = 'unknown_skill';
    } else if (tierGateForEntry(entry, effective)) {
      result.skill_skipped_reason = 'tier_required';
    } else {
      setActiveSkillForWallet(session.wallet, entry.id);
      result.skill_applied = entry.id;
    }
  }

  // ── Install candidates ───────────────────────────────────────────
  const alreadyInstalled = new Set(
    getInstalledForWallet(session.wallet).map((i) => i.entry.id),
  );
  for (const inst of body.installs ?? []) {
    if (typeof inst.connector_id !== 'string') continue;
    const entry = getEntry(inst.connector_id);
    if (!entry) {
      result.to_install.push({
        connector_id: inst.connector_id,
        reason: 'not_in_catalog',
      });
      continue;
    }
    if (entry.install_kind === 'skill') continue;
    if (alreadyInstalled.has(entry.id)) {
      result.to_install.push({ connector_id: entry.id, reason: 'already_installed' });
      continue;
    }
    if (tierGateForEntry(entry, effective)) {
      result.to_install.push({ connector_id: entry.id, reason: 'tier_required' });
      continue;
    }
    result.to_install.push({ connector_id: entry.id, reason: 'ready' });
  }

  recordAudit({
    eventType: 'directory.skill.activated',
    actor: actorFromWallet(session.wallet),
    subject: result.skill_applied ?? 'import',
    outcome: 'ok',
    req,
  });

  return NextResponse.json({ ok: true, ...result });
}
