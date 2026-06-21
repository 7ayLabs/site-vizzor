/**
 * /api/conversations
 *
 * GET  → list the SIWS-authenticated wallet's recent chat threads
 *        (newest-touched first). Sidebar consumes this for the
 *        "Recent chats" section.
 *
 * POST → create a new conversation row. Title is derived from the
 *        first user message when one is supplied; otherwise stored
 *        as the localised "New chat" fallback by the client. Returns
 *        the canonical row so the client can mutate its SWR list
 *        with the persisted id.
 *
 * Both endpoints require a live SIWS session. Anonymous callers get
 * 401 — the client's `useConversations` hook treats 401 as "no
 * history available" and renders an empty state.
 */

import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getActiveSession } from '@/lib/payment/auth-session';
import {
  createConversation,
  deriveConversationTitle,
  listConversationsForWallet,
} from '@/lib/payment/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function newConversationId(): string {
  // 18 random bytes → 24 base64url chars → ~144 bits of entropy.
  return 'conv_' + randomBytes(18).toString('base64url');
}

export async function GET() {
  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const rows = listConversationsForWallet(session.wallet, 50);
  return NextResponse.json(
    {
      ok: true,
      conversations: rows.map((r) => ({
        id: r.id,
        title: r.title,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(req: Request) {
  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  // Body is optional — a brand-new chat with no first message yet is
  // a valid state. The client uses this to reserve an id before the
  // user has typed anything.
  let body: { title?: string; firstMessage?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const title = body.title
    ? deriveConversationTitle(body.title)
    : body.firstMessage
      ? deriveConversationTitle(body.firstMessage)
      : 'New chat';

  const row = createConversation({
    id: newConversationId(),
    wallet: session.wallet,
    title,
  });

  return NextResponse.json(
    {
      ok: true,
      conversation: {
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
