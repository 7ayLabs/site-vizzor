/**
 * POST /api/predict — thin proxy from the on-site chat to the Vizzor
 * engine's canonical `POST /v1/chat` endpoint (the same one the
 * Telegram bot, CLI, and TUI consume).
 *
 * Responsibilities (only four):
 *
 *   1. Validate the request body.
 *   2. Apply the quota / burn gate (site-level monetization concern).
 *   3. Dispatch slash commands locally via `parseIntent` — info,
 *      stats, redirects. These read the cached snapshot (which IS
 *      Vizzor data) but generate no prediction content.
 *   4. For prediction intents: translate the AI SDK UIMessage shape
 *      to Vizzor's `{role, content}` shape, POST to
 *      `${VIZZOR_API_URL}/v1/chat`, transform the engine's SSE event
 *      stream into the AI SDK UI Message Stream protocol the client
 *      already consumes, and pipe it back.
 *
 * When the engine is unreachable, return an honest "Vizzor offline"
 * stream instead of fabricating a prediction. The Vizzor engine is
 * the only source of predictions on this site.
 *
 * The Vizzor `/v1/chat` SSE protocol:
 *   event: conversation   → {conversationId}                         (drop)
 *   event: token_data     → {tokens: [...]}                          (drop)
 *   event: text           → {delta: "..."}                           → text-delta
 *   event: tool_use       → {name, ...}                              → text-delta (annotated)
 *   event: error          → {message}                                → text-delta (annotated)
 *   event: done           → {usage?}                                 → text-end + [DONE]
 */

import type { UIMessage } from 'ai';
import { incrementWalletQuota, readWalletQuota } from '@/lib/quota';
import { parseIntent } from '@/lib/commands';
import {
  getActiveSession,
  getSubscriptionForActiveSession,
} from '@/lib/payment/auth-session';
import {
  PREDICT_ROUTE_REQUIREMENTS,
  assertRequiredEnv,
} from '@/lib/env';

// Fail fast in production if the predict route is misconfigured. No-op in
// dev/CI. See lib/env.ts for the declarative requirements bundle.
assertRequiredEnv('predict', PREDICT_ROUTE_REQUIREMENTS);

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

  /* ------------------- wallet auth gate (v0.3.0) ----------------- */
  // /predict is no longer anonymous. The visitor MUST complete SIWS
  // before any engine cycles are spent — this binds the free-tier
  // counter to a real wallet so it can't be reset by clearing cookies
  // or opening an incognito window. Subscriptions still bypass the
  // counter; the SIWS check is the only gate for them too.
  const session = await getActiveSession();
  if (!session) {
    return Response.json(
      {
        error: 'wallet_required',
        message:
          'Connect your wallet to predict. The free tier is bound to your wallet so the counter survives cookie clears.',
      },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
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

  const subscription = await getSubscriptionForActiveSession();
  const subscribed = !!subscription;

  if (!subscribed) {
    const quota = readWalletQuota(session.wallet);
    if (quota.exhausted) {
      return Response.json(
        {
          error: 'free_quota_exhausted',
          message:
            'Free predictions exhausted for this wallet. Subscribe at /pricing — pay in SOL on Solana.',
          quota,
        },
        { status: 402, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }

  /* --------------------- forward to vizzor engine ---------------- */
  // Counter increment happens AFTER the upstream call confirms success
  // — see `forwardToVizzor`. We pass the wallet down so the counter
  // can be bumped atomically on the success path only.
  const walletForCounter = subscribed ? null : session.wallet;
  return forwardToVizzor(body.messages, walletForCounter);
}

/* ------------------------------------------------------------------ *\
 * Upstream proxy — site sends the full message history to the Vizzor
 * engine and streams the response straight through.
 * ------------------------------------------------------------------ */

async function forwardToVizzor(
  messages: UIMessage[],
  walletForCounter: string | null,
): Promise<Response> {
  const base =
    process.env.VIZZOR_API_URL ??
    process.env.NEXT_PUBLIC_VIZZOR_API_URL ??
    'https://api.vizzor.ai';

  // Translate AI SDK UIMessage → Vizzor's flat {role, content} shape.
  const vizzorMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role,
      content: (m.parts ?? [])
        .filter((p) => p.type === 'text')
        .map((p) => ('text' in p ? p.text : ''))
        .join('\n')
        .trim(),
    }))
    .filter((m) => m.content.length > 0);

  if (vizzorMessages.length === 0) {
    return offlineResponse();
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    UPSTREAM_TIMEOUT_MS,
  );

  try {
    // The upstream engine validates an X-API-Key on every request
    // (see `vizzor/src/api/auth/middleware.ts`). The site holds a
    // single service key in env; if it's missing in prod we still try
    // the request (and surface the upstream's 401 as "offline") rather
    // than throwing at boot, since the rest of the site doesn't need
    // the engine to render.
    const apiKey = process.env.VIZZOR_API_KEY;
    const upstreamHeaders: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
    };
    if (apiKey) upstreamHeaders['x-api-key'] = apiKey;

    const upstreamRes = await fetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify({ messages: vizzorMessages }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!upstreamRes.ok || !upstreamRes.body) {
      return offlineResponse();
    }

    // Atomically bump the free-tier counter for this wallet now that
    // the upstream has agreed to deliver a stream. Subscribers pass
    // `null` and the counter is untouched.
    if (walletForCounter) {
      incrementWalletQuota(walletForCounter);
    }

    // Transform Vizzor SSE → AI SDK UI Message Stream so the client's
    // `useChat` hook renders it natively. The transform also surfaces
    // engine errors and tool-use events as readable text so visitors
    // can see when the engine hit a billing limit or invoked a tool.
    const transformed = transformVizzorStream(upstreamRes.body);

    const headers = new Headers({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'x-vercel-ai-ui-message-stream': 'v1',
      'x-vizzor-source': 'engine',
    });

    return new Response(transformed, { status: 200, headers });
  } catch {
    return offlineResponse();
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------ *\
 * Vizzor SSE → AI SDK UI Message Stream transform
 * ------------------------------------------------------------------ */

type SseEvent = { event?: string; data: unknown };

function transformVizzorStream(
  upstream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const id = 'vz-' + Date.now().toString(36);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(obj)}\n\n`),
        );

      send({ type: 'text-start', id });

      const reader = upstream.getReader();
      let buffer = '';

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE events are separated by blank lines.
          let nl: number;
          while ((nl = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 2);
            const parsed = parseSseEvent(rawEvent);
            if (!parsed) continue;
            const delta = renderVizzorEvent(parsed);
            if (delta) send({ type: 'text-delta', id, delta });
          }
        }
      } catch (err) {
        send({
          type: 'text-delta',
          id,
          delta: `\n\n⚠ stream interrupted: ${(err as Error).message}`,
        });
      } finally {
        send({ type: 'text-end', id });
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      }
    },
  });
}

function parseSseEvent(raw: string): SseEvent | null {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  const dataStr = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(dataStr) };
  } catch {
    // Plain-text data (e.g. `data: [DONE]`).
    return { event, data: dataStr };
  }
}

function renderVizzorEvent(ev: SseEvent): string | null {
  const data = ev.data as Record<string, unknown> | string;
  switch (ev.event) {
    case 'text': {
      const delta = (data as { delta?: string }).delta;
      return typeof delta === 'string' ? delta : null;
    }
    case 'error': {
      const msg = (data as { message?: string }).message ?? 'unknown error';
      // Make engine errors visible to the user — they're often
      // actionable (e.g. "credit balance is too low" → top up your key).
      return `\n\n⚠ Vizzor engine error: ${truncate(msg, 240)}`;
    }
    case 'tool_use':
    case 'tool_call': {
      const name =
        (data as { name?: string; tool?: string }).name ??
        (data as { tool?: string }).tool ??
        'tool';
      return `\n[${name}]`;
    }
    case 'tool_result': {
      // Drop tool results from the visible stream unless we want to
      // render them — they're usually JSON payloads the engine then
      // narrates with another text event.
      return null;
    }
    case 'conversation':
    case 'token_data':
    case 'usage':
    case 'done':
      return null;
    default:
      return null;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
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

function offlineResponse(): Response {
  return streamPlainText(OFFLINE_MESSAGE, null, { offline: true });
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
