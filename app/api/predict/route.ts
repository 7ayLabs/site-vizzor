/**
 * POST /api/predict — thin proxy from the on-site chat to the Vizzor
 * engine.
 *
 * This route does FOUR things, and only four:
 *
 *   1. Validate the request body.
 *   2. Apply the quota / burn gate (site-level concern — the Vizzor
 *      engine doesn't track per-browser free predictions, that's the
 *      site's monetization layer).
 *   3. Dispatch slash commands locally via `parseIntent` — info,
 *      stats, redirects. These read the cached snapshot (which IS
 *      Vizzor data) but generate no prediction content. The `/help`
 *      and bot-only redirects are pure UI affordances.
 *   4. For prediction intents: forward the raw user message to the
 *      Vizzor engine at `${VIZZOR_API_URL}/v1/site/chat` and stream the
 *      response straight back to the client. No transformation, no
 *      fallback, no local generation.
 *
 * When the Vizzor engine is unreachable, the route returns an honest
 * "Vizzor offline" stream instead of fabricating a prediction. The
 * Vizzor engine is the only source of predictions on this site.
 *
 * See `API_CONTRACT.md` for the upstream chat endpoint spec.
 */

import type { UIMessage } from 'ai';
import { buildIncrementedQuotaCookie, readQuota } from '@/lib/quota';
import { isTokenLive } from '@/lib/feature-flags';
import { verifyBurnTx } from '@/lib/solana';
import { parseIntent } from '@/lib/commands';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const UPSTREAM_TIMEOUT_MS = 30_000;

interface PredictRequest {
  messages: UIMessage[];
}

export async function POST(req: Request) {
  /* ------------------------- parse request ----------------------- */

  let body: PredictRequest;
  try {
    body = (await req.json()) as PredictRequest;
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: 'no_messages' }, { status: 400 });
  }

  const lastUserText = extractLastUserText(body.messages);
  const intent = parseIntent(lastUserText);

  /* -------------------- non-prediction commands ------------------ */
  // Info, stats, redirects don't consume engine cycles — they're
  // site-level UI affordances (read-only snapshot reads + Telegram
  // deep-links). No quota burn.
  if (intent.kind !== 'predict') {
    return streamPlainText(intent.text ?? '', null);
  }

  /* --------------------- predict gate (quota) -------------------- */

  const burnHeader = req.headers.get('x-vizzor-burn-tx');
  const quota = await readQuota();
  let burnApproved = false;

  if (burnHeader && isTokenLive()) {
    const verify = await verifyBurnTx(burnHeader);
    burnApproved = verify.ok;
    if (!verify.ok) {
      return Response.json(
        {
          error: 'burn_verification_failed',
          message:
            'The burn transaction could not be verified. Try again, or check the wallet panel.',
          reason: verify.reason,
        },
        { status: 402, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }

  if (!burnApproved && quota.exhausted) {
    return Response.json(
      {
        error: 'free_quota_exhausted',
        message: isTokenLive()
          ? 'Free predictions exhausted. Connect a wallet and burn $VIZZOR to continue.'
          : 'Free predictions exhausted. The $VIZZOR token launches soon — join the waitlist.',
        quota,
      },
      { status: 402, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // The would-be cookie. Only attached when the upstream actually
  // delivers a prediction — if Vizzor is offline, the user keeps the
  // credit. Burns don't go through the cookie.
  const cookieOnSuccess = !burnApproved
    ? buildIncrementedQuotaCookie(quota.used)
    : null;

  /* --------------------- forward to vizzor engine ---------------- */

  return forwardToVizzor(body.messages, cookieOnSuccess, burnHeader);
}

/* ------------------------------------------------------------------ *\
 * Upstream proxy — site sends the full message history to the Vizzor
 * engine and streams the response straight through.
 * ------------------------------------------------------------------ */

async function forwardToVizzor(
  messages: UIMessage[],
  cookieOnSuccess: string | null,
  burnHeader: string | null,
): Promise<Response> {
  const base =
    process.env.VIZZOR_API_URL ??
    process.env.NEXT_PUBLIC_VIZZOR_API_URL ??
    'https://api.vizzor.ai';

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    UPSTREAM_TIMEOUT_MS,
  );

  try {
    const upstreamRes = await fetch(`${base}/v1/site/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...(burnHeader ? { 'x-vizzor-burn-tx': burnHeader } : {}),
      },
      body: JSON.stringify({ messages }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!upstreamRes.ok || !upstreamRes.body) {
      // Engine couldn't deliver — don't burn the user's free credit.
      return offlineResponse(null);
    }

    // Pass the upstream stream straight through to the client. The
    // Vizzor engine emits the same AI SDK UI Message Stream protocol
    // we already consume client-side, so no transformation is needed.
    // Only NOW do we increment the quota cookie: a credit is consumed
    // only when a real prediction is delivered.
    const headers = new Headers({
      'Content-Type':
        upstreamRes.headers.get('content-type') ?? 'text/event-stream',
      'Cache-Control': 'no-store',
      'x-vercel-ai-ui-message-stream': 'v1',
      'x-vizzor-source': 'upstream',
    });
    if (cookieOnSuccess) headers.set('set-cookie', cookieOnSuccess);

    return new Response(upstreamRes.body, { status: 200, headers });
  } catch {
    return offlineResponse(null);
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------ *\
 * Honest offline response — no fake prediction. The Vizzor engine is
 * the only prediction source; when it's down we say so.
 * ------------------------------------------------------------------ */

const OFFLINE_MESSAGE = `⚠ Vizzor offline

api.vizzor.ai is unreachable. This site is a thin consumer of the
Vizzor engine — there is no local prediction fallback. Predictions
resume the moment the engine is back.

In the meantime:
  • /help — site-runnable commands (read-only stats from cached data)
  • t.me/vizzorai_bot — the Telegram bot runs its own engine instance

status: vizzor-engine offline`;

function offlineResponse(setCookie: string | null): Response {
  return streamPlainText(OFFLINE_MESSAGE, setCookie, { offline: true });
}

/* ------------------------------------------------------------------ *\
 * Plain-text streamer — used for local command output AND the offline
 * message. Emits the AI SDK UI Message Stream protocol.
 * ------------------------------------------------------------------ */

function streamPlainText(
  text: string,
  setCookie: string | null,
  meta: { offline?: boolean } = {},
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const id = 'msg-' + Date.now().toString(36);
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: 'text-start', id })}\n\n`,
        ),
      );
      for (const chunk of text.match(/.{1,40}/gs) ?? [text]) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'text-delta', id, delta: chunk })}\n\n`,
          ),
        );
      }
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: 'text-end', id })}\n\n`,
        ),
      );
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });

  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    'x-vercel-ai-ui-message-stream': 'v1',
    'x-vizzor-source': meta.offline ? 'offline' : 'local',
  });
  if (setCookie) headers.set('set-cookie', setCookie);

  return new Response(stream, { status: 200, headers });
}

function extractLastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    const text = m.parts
      .filter((p) => p.type === 'text')
      .map((p) => ('text' in p ? p.text : ''))
      .join(' ');
    if (text.trim().length > 0) return text;
  }
  return '';
}
