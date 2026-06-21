/**
 * POST /api/conversations/[id]/messages
 *
 * Append one message (user or assistant) to a conversation owned by
 * the SIWS-authenticated wallet. Bumps the conversation's `updated_at`
 * inside the same transaction so the sidebar's recency ordering stays
 * in sync.
 *
 * The chat shell calls this twice per turn:
 *   1. immediately after `sendMessage()` — role: 'user', content: prompt
 *   2. inside `useChat`'s onFinish — role: 'assistant', content: joined text
 *
 * Why client-driven persistence instead of server middleware on
 * /api/predict: the upstream chat endpoint is SSE; tee'ing the
 * stream into a DB writer would couple the persistence layer to
 * the streaming proxy and double the operational failure surface.
 * The client already owns the canonical reconstruction of the
 * assistant text (it's what gets rendered), so it's the natural
 * point of truth for what to persist.
 */

import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getActiveSession } from '@/lib/payment/auth-session';
import {
  appendConversationMessage,
  getConversationForWallet,
} from '@/lib/payment/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function newMessageId(): string {
  return 'msg_' + randomBytes(12).toString('base64url');
}

const MAX_CONTENT_CHARS = 60_000;

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: Ctx) {
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

  let body: { role?: string; content?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'bad_body' },
      { status: 400 },
    );
  }
  if (body.role !== 'user' && body.role !== 'assistant') {
    return NextResponse.json(
      { ok: false, reason: 'invalid_role' },
      { status: 400 },
    );
  }
  if (typeof body.content !== 'string' || body.content.length === 0) {
    return NextResponse.json(
      { ok: false, reason: 'content_required' },
      { status: 400 },
    );
  }
  // Cap stored content so a malformed assistant stream can't blow up
  // the row. Real assistant turns top out well under this.
  const content = body.content.slice(0, MAX_CONTENT_CHARS);
  const messageId = newMessageId();

  appendConversationMessage({
    id: messageId,
    conversationId: id,
    role: body.role,
    content,
  });

  return NextResponse.json({
    ok: true,
    message: { id: messageId, role: body.role, content },
  });
}
