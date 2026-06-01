/**
 * POST /api/predict — chat surface for the on-site Vizzor experience.
 *
 * Flow:
 *   1. Read the `vizzor.free_used` cookie via `readQuota()`.
 *   2. If the caller presented `x-vizzor-burn-tx`, verify it (Phase 2;
 *      currently always rejects since `isTokenLive()` is false).
 *   3. If the burn verifies, allow the call WITHOUT touching the free
 *      counter — paid is paid.
 *   4. If no burn and the free counter has room, allow and increment
 *      the cookie on the response.
 *   5. Otherwise: 402 Payment Required.
 *
 * Streaming uses the Vercel AI SDK (`streamText` + Anthropic provider).
 * In Phase 3 we'll swap the upstream from Anthropic to the product's
 * `api.vizzor.ai/v1/site/chat` — the streaming protocol stays the same.
 *
 * When `ANTHROPIC_API_KEY` is absent (local dev without keys) we
 * degrade to a deterministic stub stream so the UI is still demoable.
 */

import { anthropic } from '@ai-sdk/anthropic';
import { streamText, convertToModelMessages, type UIMessage } from 'ai';
import { buildIncrementedQuotaCookie, readQuota } from '@/lib/quota';
import { isTokenLive } from '@/lib/feature-flags';
import { verifyBurnTx } from '@/lib/solana';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are Vizzor, a calibrated crypto prediction agent.
You produce directional predictions for tokens across horizons from 5 minutes to 30 days.
Every response must read like a Vizzor "receipt": brief, structured, no fluff.

Format your responses like this:

SYMBOL · HORIZON · TIER
direction: <up|down|sideways> · confidence: <0.00-1.00>
entry: $<current price>
targets: bull $<n> · base $<n> · bear $<n>

trigger snapshot
  - <signal family>: <cf signed> <one-line meta>
  - <signal family>: <cf signed> <one-line meta>
  - ...

Be concise. No greetings, no apologies, no hedging. If a user asks something
outside the prediction domain, redirect them to ask about a specific symbol
and horizon (e.g. "ETH 4h" or "SOL 1d").

Use real-feeling values consistent with current market conditions. The user
is on a free trial — give them a high-quality demo prediction.`;

interface PredictRequest {
  messages: UIMessage[];
}

export async function POST(req: Request) {
  const burnHeader = req.headers.get('x-vizzor-burn-tx');

  const quota = await readQuota();
  let setCookie: string | null = null;
  let burnApproved = false;

  // Phase 2: verify the burn tx if presented. The flag gate means we
  // ignore the header entirely until the token is live, even if a
  // forward-compat client starts sending it early.
  if (burnHeader && isTokenLive()) {
    const verify = await verifyBurnTx(burnHeader);
    burnApproved = verify.ok;
    if (!verify.ok) {
      return Response.json(
        {
          error: 'burn_verification_failed',
          message:
            'The burn transaction could not be verified. Try again, or check the wallet panel for details.',
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

  // Only count free uses toward the counter; paid burns don't decrement.
  if (!burnApproved) {
    setCookie = buildIncrementedQuotaCookie(quota.used);
  }

  let body: PredictRequest;
  try {
    body = (await req.json()) as PredictRequest;
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: 'no_messages' }, { status: 400 });
  }

  // Graceful degradation: no API key → stub stream. Lets dev/CI exercise
  // the route end-to-end without provisioning credentials.
  if (!process.env.ANTHROPIC_API_KEY) {
    return stubStream(setCookie);
  }

  const modelMessages = await convertToModelMessages(body.messages);
  const result = streamText({
    model: anthropic('claude-haiku-4-5'),
    system: SYSTEM_PROMPT,
    messages: modelMessages,
    // Cache the system prompt across requests (Anthropic prompt caching).
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    },
  });

  const headers: Record<string, string> = {};
  if (setCookie) headers['set-cookie'] = setCookie;
  return result.toUIMessageStreamResponse({ headers });
}

/**
 * Deterministic stub so the chat works without an Anthropic key.
 * Emits an AI-SDK-compatible UI message stream.
 */
function stubStream(setCookie: string | null): Response {
  const stub = `BTC · 4h · tracked
direction: up · confidence: 0.62
entry: $71,200
targets: bull $72,800 · base $71,900 · bear $69,400

trigger snapshot
  - onChain        +0.48  whale_inflow $12.4M
  - logicRules     +0.41  coinbase_premium positive
  - mlEnsemble     +0.36  rsi 54.2 · ensemble 0.64
  - patternMatch   +0.22  BOS 4h up

note: anthropic_api_key not configured — this is a stub response. set ANTHROPIC_API_KEY to enable live predictions.`;

  // Encode as an AI SDK UI message stream: one text-delta event then done.
  // Format: each line is `data: {...}\n\n` (SSE-flavored).
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const id = 'stub-' + Date.now().toString(36);
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: 'text-start', id })}\n\n`,
        ),
      );
      for (const chunk of stub.match(/.{1,40}/gs) ?? [stub]) {
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
