/**
 * POST /api/predict — chat surface for the on-site Vizzor experience.
 *
 * Quota + burn gate (Phase 1+2):
 *   1. Read the `vizzor.free_used` cookie via `readQuota()`.
 *   2. If `x-vizzor-burn-tx` header is present AND `isTokenLive()`:
 *      verify it via `verifyBurnTx()`. Valid → allow without touching
 *      the free counter. Invalid → 402.
 *   3. Else if `used < FREE_PREDICTIONS`: allow, increment cookie.
 *   4. Else: 402 Payment Required.
 *
 * Engine resolution (three-tier fallback):
 *   A. Upstream Vizzor product API at `${VIZZOR_API_URL}/v1/site/predict`
 *      — when the product team ships this endpoint (separate PR in the
 *      7ayLabs/vizzor repo), it becomes the canonical source. The route
 *      streams the formatted receipt.
 *   B. Anthropic Claude with a Helios-shaped system prompt + live
 *      snapshot context (current price, recent WR, allowed families).
 *      Used when ANTHROPIC_API_KEY is set but the upstream is down.
 *   C. Local deterministic stub via `generatePrediction()`. Same shape,
 *      seeded from symbol+horizon+UTC-hour. Always available, no keys.
 *
 * The text format is identical across all three tiers — see
 * `formatPredictionText()` in `lib/predict-format.ts`.
 *
 * See `API_CONTRACT.md` at the repo root for the upstream contract spec.
 */

import { anthropic } from '@ai-sdk/anthropic';
import { streamText, convertToModelMessages, type UIMessage } from 'ai';
import { buildIncrementedQuotaCookie, readQuota } from '@/lib/quota';
import { isTokenLive } from '@/lib/feature-flags';
import { verifyBurnTx } from '@/lib/solana';
import {
  formatPredictionText,
  generatePrediction,
  type ParsedRequest,
} from '@/lib/predict-format';
import { getTicker, getTrackerWR } from '@/lib/snapshot';
import { parseIntent } from '@/lib/commands';
import type { Prediction } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const UPSTREAM_TIMEOUT_MS = 6_000;

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
  // Info, stats, and bot-only redirects bypass the quota gate — they
  // don't consume engine cycles, so we don't charge against the free
  // tier for them.
  if (intent.kind !== 'predict') {
    return streamPredictionText(intent.text ?? '', null);
  }

  /* --------------------- predict gate (quota) -------------------- */

  const burnHeader = req.headers.get('x-vizzor-burn-tx');
  const quota = await readQuota();
  let setCookie: string | null = null;
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

  if (!burnApproved) {
    setCookie = buildIncrementedQuotaCookie(quota.used);
  }

  const parsed: ParsedRequest = intent.predict!;

  /* --------------------------- engine ---------------------------- */

  // (A) Upstream Vizzor API — primary path once the product ships
  // `/v1/site/predict`. Returns a single Prediction JSON.
  const upstreamPrediction = await tryUpstreamPredict(parsed);
  if (upstreamPrediction) {
    return streamPredictionText(
      formatPredictionText(upstreamPrediction),
      setCookie,
    );
  }

  // (B) Anthropic with rich snapshot context. The model receives the
  // current ticker prices, the calibrated tracker WR, and a strict
  // format spec — so output stays on-brand even without the product.
  if (process.env.ANTHROPIC_API_KEY) {
    const modelMessages = await convertToModelMessages(body.messages);
    const result = streamText({
      model: anthropic('claude-haiku-4-5'),
      system: buildSystemPrompt(parsed),
      messages: modelMessages,
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
    });
    const headers: Record<string, string> = {};
    if (setCookie) headers['set-cookie'] = setCookie;
    return result.toUIMessageStreamResponse({ headers });
  }

  // (C) Deterministic stub — same Helios shape, seeded by symbol +
  // horizon + UTC-hour. Always available; no external dependencies.
  const stub = generatePrediction(parsed);
  return streamPredictionText(
    formatPredictionText(stub) +
      `\n\nnote: api.vizzor.ai upstream unreachable and ANTHROPIC_API_KEY not configured — this is a calibrated demo receipt.`,
    setCookie,
  );
}

/* ------------------------------------------------------------------ *\
 * Upstream call
 * ------------------------------------------------------------------ */

async function tryUpstreamPredict(
  parsed: ParsedRequest,
): Promise<Prediction | null> {
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
    const res = await fetch(`${base}/v1/site/predict`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        symbol: parsed.symbol,
        horizon: parsed.horizon,
        locale: parsed.locale,
      }),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Prediction;
    // Minimal shape check so a bad upstream doesn't poison the stream.
    if (
      !json ||
      typeof json.symbol !== 'string' ||
      typeof json.entryPrice !== 'number' ||
      typeof json.confidence !== 'number'
    ) {
      return null;
    }
    return json;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------ *\
 * Anthropic system prompt — keeps Claude on-format and on-data.
 * ------------------------------------------------------------------ */

function buildSystemPrompt(parsed: ParsedRequest): string {
  const ticker = getTicker();
  const wr = getTrackerWR();
  const tickerLines = ticker
    .map((t) => `  ${t.symbol}=${t.price} (${(t.changePct * 100).toFixed(2)}% 24h)`)
    .join('\n');

  return `You are Vizzor, a calibrated crypto prediction agent (v0.15.5 Helios).
You respond with a single structured prediction "receipt" — no chit-chat,
no apologies, no disclaimers about being an AI. Match the exact format of
the product CLI: \`vizzor predict <SYMBOL> <HORIZON>\`.

# Current market context (do not invent prices)
${tickerLines}

# Tracker calibration (use as ground truth for tier confidence)
aggregate WR: ${(wr.aggregate.wr * 100).toFixed(1)}% over ${wr.aggregate.samples} samples
best horizon: ${findBestHorizon(wr)}
worst horizon: ${findWorstHorizon(wr)}

# Required output format (exact, monospaced)
<SYMBOL> · <HORIZON> · <TIER_EMOJI> <tier>
direction: <↑|↓|↔> <up|down|sideways> · confidence <0.NN>
entry:     $<price>
targets:   bull $<n> · base $<n> · bear $<n>

trigger snapshot
  ▸ onChain            <±0.NN>  <meta>
  ▸ mlEnsemble         <±0.NN>  <meta>
  ▸ logicRules         <±0.NN>  <meta>
  ▸ patternMatch       <±0.NN>  <meta>
  ▸ predictionMarkets  <±0.NN>  <meta>
  ▸ socialNarrative    <±0.NN>  <meta>
  · smc: <BOS|CHoCH> at $<price>
  · ict: <session> · <action>

reason: <one-line confluence summary>

🔔 alerts armed at TP1 / TP2 / SL

# Tier rules
- 🌟 high-conviction : confidence ≥ 0.78
- 🐋 whale-confirmed : onChain cf ≥ 0.55
- ✅ tracked         : confidence 0.56–0.77
- ⚪ advisory        : confidence < 0.56

# Constraints
- The user's symbol + horizon are: ${parsed.symbol} ${parsed.horizon}.
- Use the current ticker price for ${parsed.symbol} as the entry.
- Bull/base/bear targets must be horizon-appropriate (4h ≈ ±3.5%,
  1d ≈ ±6%, 1h ≈ ±1.8%, 15m ≈ ±0.8%).
- Signal CFs must be in [-0.85, 0.85].
- The "meta" column is short product-style data (e.g.
  "whale_inflow $12.4M", "rsi 54.2 · ensemble 0.64", "BOS_4h_up").
- Respond in ${parsed.locale === 'es' ? 'Spanish for any prose lines (reason, smc details)' : parsed.locale === 'fr' ? 'French for any prose lines' : 'English'}. The structural keywords (direction, entry, targets, trigger snapshot) stay English — that's the product's CLI.
- No markdown. No code fences. No explanations outside the receipt.`;
}

function findBestHorizon(wr: ReturnType<typeof getTrackerWR>): string {
  let best: { h: string; wr: number; n: number } | null = null;
  for (const [h, v] of Object.entries(wr.byHorizon)) {
    if (!best || v.wr > best.wr) best = { h, wr: v.wr, n: v.samples };
  }
  return best
    ? `${best.h} ${(best.wr * 100).toFixed(1)}% (n=${best.n})`
    : 'n/a';
}

function findWorstHorizon(wr: ReturnType<typeof getTrackerWR>): string {
  let worst: { h: string; wr: number; n: number } | null = null;
  for (const [h, v] of Object.entries(wr.byHorizon)) {
    if (!worst || v.wr < worst.wr) worst = { h, wr: v.wr, n: v.samples };
  }
  return worst
    ? `${worst.h} ${(worst.wr * 100).toFixed(1)}% (n=${worst.n})`
    : 'n/a';
}

/* ------------------------------------------------------------------ *\
 * Stub streamer — emits the AI-SDK UI message protocol with our text.
 * ------------------------------------------------------------------ */

function streamPredictionText(
  text: string,
  setCookie: string | null,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const id = 'pred-' + Date.now().toString(36);
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: 'text-start', id })}\n\n`,
        ),
      );
      // Chunk by ~40 chars so the stream feels alive without bombarding.
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

  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    'x-vercel-ai-ui-message-stream': 'v1',
  };
  if (setCookie) headers['set-cookie'] = setCookie;
  return new Response(stream, { headers });
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
