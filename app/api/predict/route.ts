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

import { createHash } from 'node:crypto';
import type { UIMessage } from 'ai';
import { parseIntent } from '@/lib/commands';
import { getActiveSession } from '@/lib/payment/auth-session';
import {
  incrementWalletFreeUsage,
  insertPredictTelemetry,
} from '@/lib/payment/db';
import { enforceWalletRateLimit } from '@/lib/payment/rate-limit';
import {
  metadataTierFor,
  resolveTierWithTrialStart,
  type EffectiveTier,
} from '@/lib/payment/tier-resolver';
import { promptByteCap } from '@/lib/feature-flags';
import {
  getActivePluginIds,
  getActiveSkillId,
  dispatchPrediction,
} from '@/lib/directory/runtime';
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

  /* --------------------- 5-layer cost shield --------------------- *\
   * The cost guard runs before any LLM hop. Layered cheapest-first
   * so a malicious script bounces off the fastest check it can hit.
   *
   *   1. Prompt size cap  — refuse "novel as a prompt" upfront.
   *   2. Plan gate        — `free` tier wallets refused (402).
   *   3. Daily cap        — trial @ 5/day, pro @ 1000/day, elite ∞.
   *   4. Burst rate limit — 1 prediction / 5s / wallet.
   *   5. Engine API key   — backstop, 60 req/min on the upstream key.
   *
   * The counter is bumped only after the upstream returns 200; a
   * failed engine call doesn't burn the day cap.
  \* -------------------------------------------------------------- */

  const walletHash = hashWalletForUserId(session.wallet);
  const promptBytes = lastUserText ? Buffer.byteLength(lastUserText, 'utf8') : 0;

  // Layer 1 — prompt size.
  if (promptBytes > promptByteCap()) {
    insertPredictTelemetry({
      walletHash,
      tier: 'unknown',
      promptBytes,
      status: 413,
    });
    return Response.json(
      {
        error: 'prompt_too_long',
        message: `Your prompt exceeds the ${promptByteCap()}-byte cap. Shorten it or split it across multiple turns.`,
        promptBytes,
        cap: promptByteCap(),
      },
      { status: 413, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const effective = resolveTierWithTrialStart(session.wallet);

  // Layer 2 — plan gate.
  if (effective.kind === 'free') {
    const message =
      effective.reason === 'never_started'
        ? 'Connect first to start your 7-day Pro trial.'
        : effective.reason === 'operator_killed'
          ? 'Free trial temporarily disabled. Subscribe at /pricing to continue.'
          : 'Your 7-day Pro trial has ended. Subscribe at /pricing to keep predicting.';
    insertPredictTelemetry({ walletHash, tier: 'free', promptBytes, status: 402 });
    return Response.json(
      {
        error: 'free_trial_expired',
        reason: effective.reason,
        message,
      },
      { status: 402, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Layer 3 — daily cap (elite is unlimited; pro/trial have soft caps).
  if (effective.kind === 'pro' || effective.kind === 'trial') {
    if (effective.dailyUsed >= effective.dailyCap) {
      insertPredictTelemetry({
        walletHash,
        tier: effective.kind,
        promptBytes,
        status: 429,
      });
      return Response.json(
        {
          error: 'daily_cap_reached',
          reason: 'daily_cap',
          message: `Daily prediction cap of ${effective.dailyCap} reached for your ${effective.kind} tier. Resets at 00:00 UTC.`,
          dailyUsed: effective.dailyUsed,
          dailyCap: effective.dailyCap,
        },
        { status: 429, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }

  // Layer 4 — per-wallet burst limit (1 / 5s).
  const burstResponse = enforceWalletRateLimit(session.wallet, 'predict.burst');
  if (burstResponse) {
    insertPredictTelemetry({
      walletHash,
      tier: effective.kind,
      promptBytes,
      status: 429,
    });
    return burstResponse;
  }

  /* --------------------- forward to vizzor engine ---------------- */
  // Counter increment happens AFTER the upstream call confirms success
  // — see `forwardToVizzor`. `effective` carries the tier override (a
  // trial wallet is sent to the engine as `pro` so it gets the rich
  // response) and the subscription row (used for downstream metadata).
  return forwardToVizzor(body.messages, {
    wallet: session.wallet,
    walletHash,
    effective,
    promptBytes,
    headers: req.headers,
  });
}

/* ------------------------------------------------------------------ *\
 * Upstream proxy — site sends the full message history to the Vizzor
 * engine and streams the response straight through.
 * ------------------------------------------------------------------ */

async function forwardToVizzor(
  messages: UIMessage[],
  ctx: {
    wallet: string;
    walletHash: string;
    effective: EffectiveTier;
    promptBytes: number;
    headers: Headers;
  },
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

  // Per-surface namespaced engine user-id. The vizzor engine resolves
  // subscription tier by `user_id` from its own Postgres store (which
  // the bot writes to). Telegram users land in numeric chat IDs; web
  // users get a `web:` prefix so the two streams never collide and
  // their `aiChat.toolUse` per-day counters stay independent. The hash
  // truncation keeps the identifier opaque while still being stable
  // for the same wallet across sessions.
  const userId = `web:${ctx.walletHash}`;
  // The engine receives the EFFECTIVE tier — trial wallets are sent
  // as `pro` so the engine grants the rich response and the Telegram-
  // grade tool-use breadth during the 7-day window. Elite stays elite;
  // free wallets never reach this code (gated upstream).
  const tier = metadataTierFor(ctx.effective);
  // Best-effort locale + timezone derivation. `Accept-Language` is the
  // standard browser-forwarded preference; the timezone is a custom
  // header the client emits (`x-vizzor-timezone`) because the browser
  // doesn't expose tz in any default header. Both fall through to
  // sensible defaults if the client doesn't send them.
  // Prefer the explicit `x-vizzor-locale` header — the chat shell sets it
  // to the URL-path locale so the engine response language matches the
  // page chrome the user is actually looking at. Falls through to the
  // legacy Accept-Language derivation when the header is missing (e.g.
  // older clients or non-browser callers).
  const locale = deriveLocale(
    ctx.headers.get('x-vizzor-locale') ?? ctx.headers.get('accept-language'),
  );
  const timezone =
    ctx.headers.get('x-vizzor-timezone')?.trim() || 'UTC';

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

    // v0.4.1 — Directory wiring. Pull the wallet's active skill +
    // plugin selections from `wallet_preferences` + `user_connections`
    // and forward them to the engine. Empty values are omitted so a
    // wallet without any directory state behaves bit-identically to
    // pre-v0.4.1 callers (the engine treats missing fields as "use
    // defaults"). Lookups are cheap SQLite reads on indexed columns;
    // failures fall back to "no skill, no plugins" rather than
    // breaking the predict path.
    let activeSkillId: string | null = null;
    let activePluginIds: string[] = [];
    try {
      activeSkillId = getActiveSkillId(ctx.wallet);
      activePluginIds = getActivePluginIds(ctx.wallet);
    } catch {
      /* directory unavailable — degrade to defaults */
    }

    const upstreamRes = await fetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify({
        messages: vizzorMessages,
        userId,
        metadata: {
          tier,
          wallet: ctx.wallet,
          locale,
          timezone,
          client: 'site-web',
        },
        ...(activeSkillId ? { skill_id: activeSkillId } : {}),
        ...(activePluginIds.length > 0 ? { plugin_ids: activePluginIds } : {}),
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!upstreamRes.ok || !upstreamRes.body) {
      insertPredictTelemetry({
        walletHash: ctx.walletHash,
        tier: ctx.effective.kind,
        promptBytes: ctx.promptBytes,
        status: upstreamRes.status || 503,
      });
      return offlineResponse();
    }

    // Bump the lifetime + daily counters now that the upstream agreed
    // to deliver a stream. Elite wallets aren't subject to the cap so
    // we skip the daily bookkeeping for them.
    if (ctx.effective.kind !== 'elite') {
      incrementWalletFreeUsage(ctx.wallet);
    }
    insertPredictTelemetry({
      walletHash: ctx.walletHash,
      tier: ctx.effective.kind,
      promptBytes: ctx.promptBytes,
      status: 200,
    });

    // Transform Vizzor SSE → AI SDK UI Message Stream so the client's
    // `useChat` hook renders it natively. The transform also surfaces
    // engine errors and tool-use events as readable text so visitors
    // can see when the engine hit a billing limit or invoked a tool.
    const transformed = transformVizzorStream(upstreamRes.body);

    // v0.4.1 — Directory connector fan-out. When the upstream stream
    // closes cleanly, fire-and-forget dispatch a minimal payload to
    // every active webhook connector for this wallet (Discord, Slack,
    // generic). dispatchPrediction is best-effort and never blocks
    // the client response: failures are audit-logged inside the
    // helper. We don't parse the response text — predict is a chat
    // stream, not a single structured prediction, so the dispatched
    // payload carries just the engagement signal ("a chat reply
    // happened for wallet X") with timestamp. Per-prediction symbol
    // + direction land downstream once /v1/chronovisor/<symbol> is
    // surfaced through this route as its own dispatch path.
    const fanoutStream = transformed.pipeThrough(
      new TransformStream({
        flush: () => {
          dispatchPrediction(ctx.wallet, {
            symbol: '',
            direction: 'neutral',
            confidence: 0,
            horizon: 'chat',
            generated_at: new Date().toISOString(),
          }).catch(() => {
            /* dispatchPrediction logs its own audit row on failure */
          });
        },
      }),
    );

    const headers = new Headers({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'x-vercel-ai-ui-message-stream': 'v1',
      'x-vizzor-source': 'engine',
    });

    return new Response(fanoutStream, { status: 200, headers });
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

/**
 * Stable, opaque per-wallet engine identifier. SHA-256 truncated to 16
 * hex chars — enough entropy to avoid collisions across the active
 * user base, narrow enough to read in logs. The engine treats it as a
 * string, no decoding required.
 */
function hashWalletForUserId(wallet: string): string {
  return createHash('sha256').update(wallet).digest('hex').slice(0, 16);
}

/**
 * Pick the primary language tag out of an Accept-Language header. The
 * engine reads the first segment as the response language hint. We
 * tolerate quality values (`en-US,en;q=0.9,es;q=0.8`) and strip them.
 * Returns `'en'` when the header is missing or malformed so the engine
 * can fall back to its own default rather than receive an empty hint.
 */
// Locales the engine prompt actually understands. Anything else gets
// clamped to 'en' so we never leak an arbitrary client string into the
// upstream metadata payload.
const SUPPORTED_LOCALES = new Set(['en', 'es', 'fr']);

function deriveLocale(header: string | null): string {
  if (!header) return 'en';
  const first = header.split(',')[0]?.trim();
  if (!first) return 'en';
  // Strip quality value if any made it past the split.
  const lang = first.split(';')[0]?.trim().toLowerCase();
  if (!lang) return 'en';
  // Accept both bare ('es') and regioned ('es-419', 'en-US') forms.
  const base = lang.slice(0, 2);
  return SUPPORTED_LOCALES.has(base) ? base : 'en';
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
