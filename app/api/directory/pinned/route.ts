/**
 * PATCH /api/directory/pinned — toggle a pin for the authenticated wallet.
 *
 * Body: { item_id: string, pinned: boolean }
 *
 * Pinned catalog items (skills + connectors) populate the composer "+"
 * picker. The picker shows ONLY pins; the full catalog lives on
 * /app/directory where users can pin/unpin anything they have access
 * to. The engine never reads this — pure UI affordance.
 *
 * Tier-gating still applies: a wallet can't pin an entry it doesn't
 * have access to (would surface as actionable in the picker when it
 * isn't). Free entries are always pinnable.
 */

import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import { enforceRateLimit } from '@/lib/payment/rate-limit';
import { recordAudit, actorFromWallet } from '@/lib/payment/audit';
import { getEntry } from '@/lib/directory/catalog';
import { setPinnedItemForWallet } from '@/lib/payment/db';
import { resolveTier } from '@/lib/payment/tier-resolver';
import {
  MAX_PINNED_ITEMS,
  getPinnedItemIds,
  tierGateForEntry,
} from '@/lib/directory/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

  let body: { item_id?: unknown; pinned?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body' },
      { status: 400 },
    );
  }

  const itemId = body.item_id;
  const pinned = body.pinned;
  if (typeof itemId !== 'string' || itemId.length === 0) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_item_id' },
      { status: 400 },
    );
  }
  if (typeof pinned !== 'boolean') {
    return NextResponse.json(
      { ok: false, reason: 'invalid_pinned' },
      { status: 400 },
    );
  }
  const entry = getEntry(itemId);
  if (!entry) {
    return NextResponse.json(
      { ok: false, reason: 'unknown_item' },
      { status: 400 },
    );
  }

  if (pinned && tierGateForEntry(entry, resolveTier(session.wallet))) {
    return NextResponse.json(
      { ok: false, reason: 'tier_required', required_tier: entry.required_tier },
      { status: 402, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Enforce the cap on the way in so a buggy client or a direct API
  // hit can't grow the pin set past the picker's design budget. Unpin
  // requests + re-pins (already in the set) bypass the check.
  if (pinned) {
    const existing = getPinnedItemIds(session.wallet);
    if (!existing.includes(itemId) && existing.length >= MAX_PINNED_ITEMS) {
      return NextResponse.json(
        {
          ok: false,
          reason: 'pin_limit_reached',
          limit: MAX_PINNED_ITEMS,
        },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }

  setPinnedItemForWallet(session.wallet, itemId, pinned);
  recordAudit({
    eventType: pinned ? 'directory.skill.pinned' : 'directory.skill.unpinned',
    actor: actorFromWallet(session.wallet),
    subject: itemId,
    outcome: 'ok',
    req,
  });
  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
