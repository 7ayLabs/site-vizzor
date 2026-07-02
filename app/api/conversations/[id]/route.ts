/**
 * /api/conversations/[id]
 *
 * GET    → return the conversation header + all messages, oldest
 *          first. Used by the sidebar when the user taps a past chat.
 *
 * PATCH  → update the conversation title (free-form rename).
 *
 * DELETE → drop the conversation and (via foreign-key cascade) its
 *          messages. The "Clear all" button is implemented client-side
 *          by deleting each row in turn — there's no bulk endpoint
 *          because the per-row delete is cheap and the user-confirm
 *          UX is per-row anyway.
 *
 * All three require a live SIWS session that owns the row; 401 for
 * unauthenticated and 404 for foreign or missing ids.
 */

import { NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/payment/auth-session';
import {
  countActiveIntentsForConversation,
  deleteConversationForWallet,
  getConversationForWallet,
  listMessagesForConversation,
  updateConversationTitle,
} from '@/lib/payment/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401 },
    );
  }
  const { id } = await ctx.params;
  const conv = getConversationForWallet(id, session.wallet);
  if (!conv) {
    return NextResponse.json(
      { ok: false, reason: 'not_found' },
      { status: 404 },
    );
  }
  const messages = listMessagesForConversation(conv.id);
  return NextResponse.json(
    {
      ok: true,
      conversation: {
        id: conv.id,
        title: conv.title,
        createdAt: conv.created_at,
        updatedAt: conv.updated_at,
      },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401 },
    );
  }
  const { id } = await ctx.params;
  const owned = getConversationForWallet(id, session.wallet);
  if (!owned) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });
  }
  let body: { title?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'bad_body' },
      { status: 400 },
    );
  }
  if (!body.title || typeof body.title !== 'string') {
    return NextResponse.json(
      { ok: false, reason: 'title_required' },
      { status: 400 },
    );
  }
  updateConversationTitle(id, session.wallet, body.title);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401 },
    );
  }
  const { id } = await ctx.params;

  // v0.5.1 — chat-delete guard. If the conversation has any active
  // capability intents (pending or signed) we return 409 unless the
  // client asserts `?force=1`. Deleting the conversation record does
  // NOT drop the intent — capability_audit has a NULLABLE
  // conversation_id and no ON DELETE cascade — so a signed transfer
  // still executes on the engine. The guard is about giving the user
  // an explicit "yes, I know" moment before losing chat history for
  // a workflow that still has money on the line.
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';
  if (!force) {
    try {
      const { count, kinds } = countActiveIntentsForConversation(
        session.wallet,
        id,
      );
      if (count > 0) {
        return NextResponse.json(
          {
            ok: false,
            reason: 'active_workflows',
            count,
            kinds,
          },
          { status: 409 },
        );
      }
    } catch {
      /* if the audit read fails, fall through to normal delete —
       * the guard is UX polish, not a security control. Refusing
       * deletion because of an infra blip would be worse. */
    }
  }

  const deleted = deleteConversationForWallet(id, session.wallet);
  if (!deleted) {
    return NextResponse.json(
      { ok: false, reason: 'not_found' },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
