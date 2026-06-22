/**
 * POST /api/v1/chat — CLI thin-client proxy.
 *
 * This route is consumed by the Vizzor CLI's HostedProvider
 * (`vizzor/src/ai/providers/hosted.ts`) when the operator picks the
 * Hosted plan during onboarding. The flow:
 *
 *   1. CLI sends { messages, systemPrompt, metadata: {source:'cli-hosted'} }
 *      with the `X-Vizzor-Auth: <vizzor_auth_v1 token>` header (the
 *      token persisted in `~/.vizzor/auth.json` during the wallet-pair
 *      wizard step).
 *
 *   2. This route verifies the HMAC signature against VIZZOR_AUTH_SECRET,
 *      extracts {wallet, tier, exp} from the payload, and forwards the
 *      request to the actual Vizzor engine (${VIZZOR_API_URL}/v1/chat)
 *      using the site's privileged X-API-Key.
 *
 *   3. The engine streams an SSE response back. We pipe it straight to
 *      the CLI without transformation — the CLI's HostedProvider speaks
 *      the engine's native event protocol, so no AI SDK adapter is
 *      needed (unlike the on-site web proxy at /api/predict).
 *
 * Failure modes are JSON-shaped so the HostedProvider's typed error
 * hierarchy maps cleanly:
 *
 *   401 → { error: 'auth_invalid'   }  → HostedAuthError
 *   402 → { error: 'quota',  upgradeHint }  → HostedQuotaError
 *   429 → { error: 'rate_limited'   }  → HostedRateLimitError
 *   503 → { error: 'engine_offline' }  → HostedUnreachableError
 *   5xx → { error: 'upstream'       }  → HostedServerError
 */

import { verifyVizzorAuthToken } from '@/lib/payment/vizzor-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UPSTREAM_TIMEOUT_MS = 120_000;

interface CliMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface CliChatBody {
  messages: CliMessage[];
  systemPrompt?: string;
  metadata?: { source?: string };
}

export async function POST(req: Request): Promise<Response> {
  // ------------------------------------------------------------- auth -----
  const authHeader = req.headers.get('x-vizzor-auth');
  if (!authHeader) {
    return jsonError(401, 'auth_missing', 'X-Vizzor-Auth header is required');
  }

  const secret = process.env.VIZZOR_AUTH_SECRET;
  const verifyResult = verifyVizzorAuthToken(authHeader, secret);
  if (!verifyResult.ok) {
    if (verifyResult.reason === 'no_secret_configured') {
      // Server is misconfigured — surface honestly so operators can
      // diagnose. The CLI maps this to HostedServerError.
      return jsonError(
        500,
        'server_misconfigured',
        'VIZZOR_AUTH_SECRET is not set on the proxy host',
      );
    }
    return jsonError(401, 'auth_invalid', `Token rejected: ${verifyResult.reason}`);
  }
  const { walletAddress, tier } = verifyResult.info;

  // ----------------------------------------------------------- payload ----
  let body: CliChatBody;
  try {
    body = (await req.json()) as CliChatBody;
  } catch {
    return jsonError(400, 'malformed_body', 'Body must be valid JSON');
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonError(400, 'no_messages', 'messages[] is required');
  }
  for (const m of body.messages) {
    if (
      !m ||
      (m.role !== 'user' && m.role !== 'assistant') ||
      typeof m.content !== 'string'
    ) {
      return jsonError(400, 'bad_message', 'Each message needs role + content');
    }
  }

  // ----------------------------------------------- forward to engine ------
  const base = (
    process.env.VIZZOR_API_URL ??
    process.env.NEXT_PUBLIC_VIZZOR_API_URL ??
    'https://api.vizzor.ai'
  ).replace(/\/+$/, '');

  const engineHeaders: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
  };
  const apiKey = process.env.VIZZOR_API_KEY;
  if (apiKey) engineHeaders['x-api-key'] = apiKey;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: engineHeaders,
      cache: 'no-store',
      signal: controller.signal,
      body: JSON.stringify({
        messages: body.messages,
        systemPrompt: body.systemPrompt,
        // The engine uses the wallet-namespaced userId for tier resolution
        // + per-wallet quota / rate-limit. The Hosted CLI is a first-class
        // surface like Telegram + the web — so the engine treats it as
        // such (its own per-day chat counter, its own quota gate).
        userId: `cli:${walletAddress}`,
        metadata: {
          tier,
          wallet: walletAddress,
          client: body.metadata?.source ?? 'cli-hosted',
        },
      }),
    });
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(503, 'engine_offline', `Vizzor engine unreachable: ${msg}`);
  }

  // Re-shape upstream failures into the JSON envelope the CLI expects.
  if (!upstreamRes.ok) {
    clearTimeout(timeout);
    const text = await upstreamRes.text().catch(() => '');
    if (upstreamRes.status === 401 || upstreamRes.status === 403) {
      return jsonError(401, 'auth_invalid', `Engine rejected the request: ${text}`);
    }
    if (upstreamRes.status === 402) {
      // The engine may have included an upgrade hint — try to pass it
      // through to the CLI for a richer prompt.
      let upgradeHint: string | undefined;
      try {
        const parsed = JSON.parse(text) as { upgradeHint?: string };
        upgradeHint = parsed.upgradeHint;
      } catch {
        /* swallow */
      }
      return Response.json(
        { error: 'quota', upgradeHint: upgradeHint ?? 'Upgrade your plan to continue.' },
        { status: 402 },
      );
    }
    if (upstreamRes.status === 429) {
      return jsonError(429, 'rate_limited', 'Rate limit exceeded. Retry shortly.');
    }
    return jsonError(502, 'upstream', `Engine returned HTTP ${upstreamRes.status}`);
  }

  // ----------------------------------------- pipe SSE straight back -------
  if (!upstreamRes.body) {
    clearTimeout(timeout);
    return jsonError(502, 'upstream', 'Engine returned an empty body');
  }
  // Forward the SSE stream as-is; the CLI's HostedProvider speaks the
  // engine's native event protocol.
  return new Response(upstreamRes.body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}

// Tiny helper so every failure path emits the same JSON envelope shape.
function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status });
}
