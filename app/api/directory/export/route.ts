/**
 * GET /api/directory/export — wallet's directory profile, exportable.
 *
 * Returns the active skill id + the list of installed connector ids
 * (NOT credentials — those are per-wallet encrypted and can't be
 * decrypted into another context anyway). Used by the wallet owner
 * to back up their Directory state or hand-off between two wallets.
 *
 * The response shape is stable so older site versions can still
 * `import` newer exports as long as `version` matches.
 */

import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import { enforceRateLimit } from '@/lib/payment/rate-limit';
import {
  getActiveSkillId,
  getInstalledForWallet,
} from '@/lib/directory/runtime';

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

  const active_skill_id = getActiveSkillId(session.wallet);
  const installs = getInstalledForWallet(session.wallet).map((i) => ({
    connector_id: i.entry.id,
    category: i.entry.category,
    installed_at: i.installed_at,
  }));

  return NextResponse.json(
    {
      ok: true,
      version: 1,
      exported_at: new Date().toISOString(),
      active_skill_id,
      installs,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
