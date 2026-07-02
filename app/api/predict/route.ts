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
  getActiveSkillId,
  dispatchPrediction,
  buildSkillPrimingMessages,
} from '@/lib/directory/runtime';
import { getEnabledCapabilities, insertPendingIntent } from '@/lib/payment/db';
import {
  buildCanonicalIntent,
  buildIntentPrimingMessages,
  isCapId,
  parsePendingIntent,
  type CapId,
} from '@/lib/capabilities/intent';
import { parseTradePlan } from '@/lib/trade/trade-plan';
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
  /**
   * v0.5.0 — agent-payment capabilities the user has armed in the
   * composer tray. The engine may emit `intent_required` SSE events
   * corresponding to any capability listed here; anything outside
   * this array is treated as "predict-only" (the pre-v0.5.0 behavior).
   *
   * Server-side we intersect this array with the wallet's enabled
   * set from `wallet_preferences.enabled_capabilities` — the UI hint
   * is advisory, the DB is authoritative. That way a compromised
   * session or a hand-crafted request can't unlock a capability the
   * user hasn't explicitly opted into from settings.
   */
  capabilities?: unknown;
  /**
   * v0.5.1 — intents the site already minted this turn from the
   * inline command syntax (`send / pay / flow / auto`). Forwarded to
   * the engine so its LLM can READ the workflow structure and
   * reference the queued action in its prediction commentary. Shape
   * per intent: { intent_id, kind, symbol, amount, to_addr }.
   *
   * The engine is expected to inject a synthetic system message
   * ("The user has queued N workflows this turn: …") before the
   * user turn so the LLM narrates them naturally. See
   * docs/spec/vizzor-engine-v0.5.1.md for the exact injection shape.
   */
  queued_intents?: unknown;
  /**
   * v0.5.1 — snapshot of the connected wallet's SOL + top-N SPL
   * balances at prompt-submit time. Forwarded so the engine's LLM
   * can write a trade plan grounded in what the user actually holds
   * ("you have 0.4 SOL — this plan uses 0.15") instead of guessing.
   * Optional; unset when the balance route was unreachable.
   */
  wallet_context?: unknown;
}

type QueuedIntentMeta = {
  intent_id: string;
  kind: CapId;
  symbol: string;
  amount: string;
  to_addr: string;
};

type WalletContext = {
  wallet: string;
  network: string;
  as_of: number;
  sol: number | null;
  spl: Array<{ mint: string; symbol: string | null; balance: number; decimals: number }>;
};

function normalizeWalletContext(raw: unknown): WalletContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.wallet !== 'string' ||
    typeof o.network !== 'string' ||
    typeof o.as_of !== 'number'
  ) {
    return null;
  }
  const sol =
    typeof o.sol === 'number' && Number.isFinite(o.sol) ? o.sol : null;
  const spl = Array.isArray(o.spl)
    ? o.spl
        .filter((x): x is Record<string, unknown> =>
          Boolean(x && typeof x === 'object'),
        )
        .filter(
          (x) =>
            typeof x.mint === 'string' &&
            typeof x.balance === 'number' &&
            Number.isFinite(x.balance) &&
            typeof x.decimals === 'number',
        )
        .slice(0, 20)
        .map((x) => ({
          mint: x.mint as string,
          symbol: typeof x.symbol === 'string' ? x.symbol : null,
          balance: x.balance as number,
          decimals: x.decimals as number,
        }))
    : [];
  return { wallet: o.wallet, network: o.network, as_of: o.as_of, sol, spl };
}

function normalizeQueuedIntents(raw: unknown): QueuedIntentMeta[] {
  if (!Array.isArray(raw)) return [];
  const out: QueuedIntentMeta[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (
      typeof o.intent_id !== 'string' ||
      typeof o.symbol !== 'string' ||
      typeof o.amount !== 'string' ||
      typeof o.to_addr !== 'string' ||
      !isCapId(o.kind)
    ) {
      continue;
    }
    out.push({
      intent_id: o.intent_id,
      kind: o.kind,
      symbol: o.symbol,
      amount: o.amount,
      to_addr: o.to_addr,
    });
    if (out.length >= 8) break; // hard cap — matches composer parse loop
  }
  return out;
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

  /* --------------------- capability allow-list ------------------- */
  // The UI sends the list of capabilities the user armed in the tray.
  // We intersect it with the wallet's enabled set in
  // `wallet_preferences.enabled_capabilities` — the DB is authoritative.
  // Free-tier requests can never reach this point (Layer 2 gate above
  // returned 402), so a valid `effective` here implies a paying wallet
  // that MAY have enabled capabilities.
  const requestedCaps = Array.isArray(body.capabilities)
    ? body.capabilities.filter(isCapId)
    : [];
  let allowedCaps: CapId[] = [];
  if (requestedCaps.length > 0) {
    try {
      const enabled = new Set(getEnabledCapabilities(session.wallet));
      allowedCaps = requestedCaps.filter((c) => enabled.has(c));
    } catch {
      /* db unavailable — degrade to zero capabilities, safe closed */
      allowedCaps = [];
    }
  }

  /* --------------------- forward to vizzor engine ---------------- */
  // Counter increment happens AFTER the upstream call confirms success
  // — see `forwardToVizzor`. `effective` carries the tier override (a
  // trial wallet is sent to the engine as `pro` so it gets the rich
  // response) and the subscription row (used for downstream metadata).
  // v0.5.1 — queued intents metadata. The site mints these before
  // firing /predict when the user's prompt contains inline command
  // syntax. We forward as-is so the engine's LLM can narrate the
  // workflow; there's no server-side authorization to do here (the
  // intents themselves were minted through /api/capabilities/create-intent
  // which already ran the tier + enabled + rate-limit checks).
  const queuedIntents = normalizeQueuedIntents(body.queued_intents);
  // v0.5.1 — wallet-balance snapshot. Client fetches this before
  // firing /predict; we verify the wallet field matches the session
  // (defense against a hostile client injecting someone else's
  // balances into the LLM context) and forward. Optional — a null
  // context is treated by the engine as "no balance info", not an
  // error.
  const rawContext = normalizeWalletContext(body.wallet_context);
  const walletContext =
    rawContext && rawContext.wallet === session.wallet ? rawContext : null;

  return forwardToVizzor(body.messages, {
    wallet: session.wallet,
    walletHash,
    effective,
    promptBytes,
    headers: req.headers,
    capabilities: allowedCaps,
    queuedIntents,
    walletContext,
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
    /** Allow-listed capabilities the engine may trigger this turn. */
    capabilities: CapId[];
    /** v0.5.1 — intents the site minted this turn, forwarded so the
     *  engine's LLM can narrate them. */
    queuedIntents: QueuedIntentMeta[];
    /** v0.5.1 — wallet balance snapshot forwarded so the LLM can
     *  ground its trade plans in what the user actually holds. */
    walletContext: WalletContext | null;
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

    // v0.4.1 — Directory wiring. Pull the wallet's active skill from
    // `wallet_preferences` and forward it to the engine. Empty values
    // are omitted so a wallet without any directory state behaves
    // bit-identically to pre-v0.4.1 callers (the engine treats missing
    // fields as "use defaults"). Lookup is a cheap SQLite read on an
    // indexed column; failure falls back to "no skill" rather than
    // breaking the predict path.
    let activeSkillId: string | null = null;
    try {
      activeSkillId = getActiveSkillId(ctx.wallet);
    } catch {
      /* directory unavailable — degrade to defaults */
    }

    // v0.4.1 — defense-in-depth priming for skills. The engine on
    // `feat/v0.4.1/connector-directory` honours body.skill_id by
    // prepending the skill's systemPromptPrefix to the chat system
    // prompt; the engine on `main` (what api.vizzor.ai runs today)
    // doesn't yet. Prepending a two-message priming exchange at the
    // start of the message history makes the skill bias take hold
    // against EITHER engine — the v0.4.1 engine sees both signals
    // and the prefix wins; the legacy engine sees only the priming
    // exchange and treats it as established conversation context.
    //
    // Once every engine is on v0.4.1, the priming becomes redundant
    // and this block can collapse into just the body.skill_id pass-
    // through.
    const skillPriming = buildSkillPrimingMessages(activeSkillId);
    // v0.5.1 — when queued_intents ride this turn, prepend a
    // priming pair that pins the trust model: user-wallet-signed via
    // SIWS on the site, NOT agent-executed. Otherwise the engine's
    // base prompt drifts into "no wallet provisioned / paper
    // trading" refusals (2026-07 regression). See
    // lib/capabilities/intent.ts:buildIntentPrimingMessages.
    const intentPriming = buildIntentPrimingMessages(ctx.queuedIntents);
    const primedMessages = [
      ...skillPriming,
      ...intentPriming,
      ...vizzorMessages,
    ];

    if (activeSkillId) {
      // eslint-disable-next-line no-console
      console.log(
        `[directory] /api/predict wallet=${ctx.walletHash.slice(0, 8)}… ` +
          `skill=${activeSkillId}`,
      );
    }

    const upstreamRes = await fetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify({
        messages: primedMessages,
        userId,
        metadata: {
          tier,
          wallet: ctx.wallet,
          locale,
          timezone,
          client: 'site-web',
        },
        ...(activeSkillId ? { skill_id: activeSkillId } : {}),
        // v0.5.0 — agent-payment capabilities. Only the allow-listed
        // subset (intersection of UI-armed + DB-enabled) is forwarded.
        // Empty array is elided so a pre-v0.5.0 engine receives the
        // same body shape as before.
        ...(ctx.capabilities.length > 0
          ? { capabilities: ctx.capabilities }
          : {}),
        // v0.5.1 — intents the site minted this turn from inline
        // command syntax. Forwarded so the engine's LLM narrates the
        // workflow. Pre-v0.5.1 engines ignore the field.
        ...(ctx.queuedIntents.length > 0
          ? { queued_intents: ctx.queuedIntents }
          : {}),
        // v0.5.1 — wallet-balance snapshot at prompt-submit time.
        // Engine's LLM uses it to write trade plans grounded in the
        // user's actual holdings. Pre-v0.5.1 engines ignore.
        ...(ctx.walletContext ? { wallet_context: ctx.walletContext } : {}),
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
    // v0.5.0 — the transform also inspects `intent_required` events,
    // persists the pending intent to `capability_audit`, and re-emits
    // it as a `data-intent-required` chunk so the client modal opens.
    const transformed = transformVizzorStream(upstreamRes.body, {
      wallet: ctx.wallet,
      allowedCapabilities: new Set(ctx.capabilities),
    });

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

interface StreamContext {
  wallet: string;
  allowedCapabilities: ReadonlySet<CapId>;
}

function transformVizzorStream(
  upstream: ReadableStream<Uint8Array>,
  ctx: StreamContext,
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
            // v0.5.0 — intent_required lands as a side-channel data
            // part after we've persisted the pending row. The engine
            // can only emit intents matching a capability the wallet
            // has enabled (server-side allow-list from earlier); a
            // stray intent for a non-allowed capability is dropped
            // here as a defense-in-depth guardrail.
            if (parsed.event === 'intent_required') {
              const intent = parsePendingIntent(parsed.data);
              if (!intent) continue;
              if (!ctx.allowedCapabilities.has(intent.kind)) {
                continue;
              }
              try {
                insertPendingIntent({
                  intentId: intent.intent_id,
                  wallet: ctx.wallet,
                  kind: intent.kind,
                  network: intent.network,
                  symbol: intent.symbol,
                  amount: intent.amount,
                  amountUsd: null,
                  fromAddr: intent.from_addr,
                  toAddr: intent.to_addr,
                  canonical: buildCanonicalIntent(intent),
                  nonce: intent.nonce,
                  issuedAt: intent.issued_at,
                  ttlAt: intent.ttl_at,
                });
              } catch {
                /* dup intent_id → row exists — client picks up the
                   already-persisted state via the settlement route.
                   Continuing here lets the client still open the
                   modal so the user can complete the flow. */
              }
              send({
                type: 'data-intent-required',
                id: intent.intent_id,
                data: intent,
                transient: false,
              });
              continue;
            }
            // v0.5.2 Phase 1 — trade_plan side-channel. Engine emits
            // a structured plan alongside its prose response; site
            // renders it as an in-thread TradePlanCard. No server-
            // side persistence yet (alerts get persisted by the
            // downstream POST /api/alerts calls the card issues);
            // this is a pass-through re-emit into the AI SDK data
            // stream so useChat's onData handler picks it up.
            if (parsed.event === 'trade_plan') {
              const plan = parseTradePlan(parsed.data);
              if (!plan) continue;
              send({
                type: 'data-trade-plan',
                id: plan.plan_id,
                data: plan,
                transient: false,
              });
              continue;
            }
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
