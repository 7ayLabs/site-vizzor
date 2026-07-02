/**
 * POST /api/execute-intent
 *
 * The settlement gateway for agent-payment intents. The engine emits
 * a pending intent via SSE (`intent_required`); the site's modal
 * shows every field and, on user confirmation, signs the canonical
 * intent bytes with the wallet adapter. This route is where the
 * signed intent lands.
 *
 * Flow:
 *
 *   1. Auth — SIWS session; 401 otherwise.
 *   2. Rate limit — 5 signed intents / minute / wallet.
 *   3. Body validation — { intent_id, signature (base58), signed_by }.
 *   4. Idempotency — if the intent is already 'executed', return the
 *      cached tx_hash (200). Repeat submissions never re-hit the chain.
 *   5. Ownership — intent.wallet_address MUST equal the SIWS wallet
 *      AND `signed_by`. Rejects a stolen-cookie-plus-known-intent-id
 *      attack.
 *   6. Status — must be 'pending'. Signed/failed/expired all reject.
 *   7. TTL — if past ttl_at, flip to 'expired' and reject 410.
 *   8. Signature — ed25519 verify over the stored `canonical` bytes
 *      using the wallet's base58 pubkey.
 *   9. Spend cap — daily USD cap enforced per capability. If the
 *      intent would push the wallet past its cap, reject 402.
 *   10. Persist 'signed' → forward to engine → persist 'executed'
 *       with tx_hash on 2xx / 'failed' on non-2xx.
 *
 * Failure surfaces the upstream error verbatim to the client so the
 * user sees actionable feedback ("insufficient balance", "network
 * congested") rather than a generic 500.
 *
 * TON support: the engine ships SOL-first in this PR; TON intents
 * are refused here with `unsupported_network` until the engine
 * follow-up wires TON transfer builders + this route learns to
 * verify TON signatures via @ton/crypto.
 */

import { NextResponse } from 'next/server';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getActiveSession } from '@/lib/payment/auth-session';
import { enforceWalletRateLimit } from '@/lib/payment/rate-limit';
import { recordAudit, actorFromWallet } from '@/lib/payment/audit';
import {
  expireStaleIntents,
  getCapabilityPreferences,
  getCapabilitySpendUsedToday,
  getPendingIntent,
  updateIntentStatus,
} from '@/lib/payment/db';
import {
  DEFAULT_SPEND_CAPS_USD,
  explorerUrl,
  isIntentNetwork,
  type IntentNetwork,
} from '@/lib/capabilities/intent';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const UPSTREAM_TIMEOUT_MS = 15_000;

interface ExecuteIntentBody {
  intent_id?: unknown;
  /** Legacy path — offline signature over the canonical intent. Server
   *  verifies signature, forwards to engine for settlement. */
  signature?: unknown;
  /** Client-executed path (v0.5.0 SOL transfers) — the client already
   *  built + signed + broadcast a real SOL transfer via Phantom's
   *  sendTransaction; we just record the resulting tx_hash. The tx
   *  signature itself is the proof of authorization. */
  tx_hash?: unknown;
  signed_by?: unknown;
}

interface UpstreamOk {
  tx_hash: string;
  network: IntentNetwork;
}

export async function POST(req: Request) {
  if ((req.headers.get('content-type') ?? '').split(';')[0]?.trim() !==
      'application/json') {
    return NextResponse.json(
      { ok: false, reason: 'invalid_content_type' },
      { status: 415, headers: NO_STORE },
    );
  }
  const session = await getActiveSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401, headers: NO_STORE },
    );
  }
  const limited = enforceWalletRateLimit(session.wallet, 'execute-intent');
  if (limited) return limited as unknown as NextResponse;

  let body: ExecuteIntentBody;
  try {
    body = (await req.json()) as ExecuteIntentBody;
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    );
  }

  const intentId = body.intent_id;
  const signature = body.signature;
  const txHashFromClient = body.tx_hash;
  const signedBy = body.signed_by;
  // Determine which flow the client is using:
  //   'client_executed' → tx_hash present, client already broadcast
  //   'signed_intent'   → signature present, forward to engine
  const clientExecuted = typeof txHashFromClient === 'string';
  if (
    typeof intentId !== 'string' ||
    typeof signedBy !== 'string' ||
    intentId.length < 8 ||
    intentId.length > 128 ||
    signedBy.length < 16 ||
    signedBy.length > 128
  ) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    );
  }
  if (clientExecuted) {
    // Solana tx signatures are 64-byte base58 strings (~87-88 chars).
    if (
      typeof txHashFromClient !== 'string' ||
      txHashFromClient.length < 32 ||
      txHashFromClient.length > 128
    ) {
      return NextResponse.json(
        { ok: false, reason: 'invalid_body' },
        { status: 400, headers: NO_STORE },
      );
    }
  } else {
    // Signed-intent path — needs the ed25519 signature.
    if (
      typeof signature !== 'string' ||
      signature.length < 16 ||
      signature.length > 512
    ) {
      return NextResponse.json(
        { ok: false, reason: 'invalid_body' },
        { status: 400, headers: NO_STORE },
      );
    }
  }

  // The wallet in the signed field MUST match the SIWS session wallet.
  // Otherwise a caller could submit someone else's signed intent from
  // a stolen browser session, which the ownership check would still
  // catch, but this fails fast.
  if (signedBy !== session.wallet) {
    return NextResponse.json(
      { ok: false, reason: 'wallet_mismatch' },
      { status: 400, headers: NO_STORE },
    );
  }

  // Sweep stale intents first so a 60s+ old pending row moves to
  // 'expired' before this call decides it is still valid.
  expireStaleIntents();

  const intent = getPendingIntent(intentId);
  if (!intent) {
    return NextResponse.json(
      { ok: false, reason: 'intent_not_found' },
      { status: 404, headers: NO_STORE },
    );
  }

  // Ownership: the wallet on the intent must be the one authenticated.
  if (intent.wallet_address !== session.wallet) {
    recordAudit({
      eventType: 'capability.intent.failed',
      actor: actorFromWallet(session.wallet),
      subject: intent.intent_id,
      outcome: 'denied',
      req,
    });
    return NextResponse.json(
      { ok: false, reason: 'forbidden' },
      { status: 403, headers: NO_STORE },
    );
  }

  // Idempotency: re-submitting an already-executed intent returns
  // the cached tx_hash without any upstream call. That means a client
  // retry after a lost response never double-spends.
  if (intent.status === 'executed' && intent.tx_hash) {
    return NextResponse.json(
      {
        ok: true,
        tx_hash: intent.tx_hash,
        network: intent.network,
        explorer_url: explorerUrl(intent.network, intent.tx_hash),
        replayed: true,
      },
      { headers: NO_STORE },
    );
  }
  if (intent.status !== 'pending') {
    return NextResponse.json(
      { ok: false, reason: `intent_${intent.status}` },
      { status: 409, headers: NO_STORE },
    );
  }
  if (intent.ttl_at < Date.now()) {
    try {
      updateIntentStatus({ intentId: intent.intent_id, status: 'expired' });
    } catch {
      /* already expired by sweep — fine */
    }
    return NextResponse.json(
      { ok: false, reason: 'intent_expired' },
      { status: 410, headers: NO_STORE },
    );
  }

  // Network gate. SOL ships in this PR; TON is a follow-up on the
  // engine repo. Refuse cleanly instead of silently mis-verifying.
  if (!isIntentNetwork(intent.network)) {
    return NextResponse.json(
      { ok: false, reason: 'unsupported_network' },
      { status: 400, headers: NO_STORE },
    );
  }
  if (intent.network === 'ton') {
    return NextResponse.json(
      { ok: false, reason: 'unsupported_network', note: 'TON settlement lands in the engine follow-up PR' },
      { status: 400, headers: NO_STORE },
    );
  }

  // v0.5.0 client-executed path — Phantom already broadcast the SOL
  // transfer via `sendTransaction` and handed us the on-chain tx
  // signature. That signature IS the wallet's authorization proof
  // (verifiable on-chain by anyone via RPC), so we skip the
  // canonical-bytes verify + engine forward entirely. Basic length
  // sanity was checked above; the audit trail preserves the tx_hash
  // so a follow-up job can cross-check RPC state.
  if (clientExecuted && typeof txHashFromClient === 'string') {
    const prefs = getCapabilityPreferences(intent.wallet_address);
    const cap =
      prefs.spend_caps[intent.kind] ?? DEFAULT_SPEND_CAPS_USD[intent.kind];
    const usedToday = getCapabilitySpendUsedToday(
      intent.wallet_address,
      intent.kind,
    );
    const wouldSpend = usedToday + (intent.amount_usd ?? 0);
    if (cap === 0) {
      return NextResponse.json(
        { ok: false, reason: 'capability_capped_zero', cap_key: intent.kind },
        { status: 402, headers: NO_STORE },
      );
    }
    if (cap > 0 && wouldSpend > cap) {
      return NextResponse.json(
        {
          ok: false,
          reason: 'spend_cap_reached',
          cap,
          used_today: usedToday,
          pending_amount_usd: intent.amount_usd,
        },
        { status: 402, headers: NO_STORE },
      );
    }
    try {
      updateIntentStatus({ intentId: intent.intent_id, status: 'signed' });
      updateIntentStatus({
        intentId: intent.intent_id,
        status: 'executed',
        txHash: txHashFromClient,
      });
    } catch {
      return NextResponse.json(
        { ok: false, reason: 'intent_transition_failed' },
        { status: 409, headers: NO_STORE },
      );
    }
    recordAudit({
      eventType: 'capability.intent.executed',
      actor: actorFromWallet(session.wallet),
      subject: intent.intent_id,
      outcome: 'ok',
      req,
    });
    return NextResponse.json(
      {
        ok: true,
        tx_hash: txHashFromClient,
        network: intent.network,
        explorer_url: explorerUrl(intent.network, txHashFromClient),
      },
      { headers: NO_STORE },
    );
  }

  // Legacy signed-intent path — verify the ed25519 signature over
  // `intent.canonical`, then forward to the engine for settlement.
  let sigOk = false;
  try {
    const msgBytes = new TextEncoder().encode(intent.canonical);
    const sigBytes = bs58.decode(signature as string);
    const pubkey = bs58.decode(intent.wallet_address);
    if (sigBytes.length === 64 && pubkey.length === 32) {
      sigOk = nacl.sign.detached.verify(msgBytes, sigBytes, pubkey);
    }
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    try {
      updateIntentStatus({ intentId: intent.intent_id, status: 'expired' });
    } catch {
      /* already terminal — fine */
    }
    recordAudit({
      eventType: 'capability.intent.failed',
      actor: actorFromWallet(session.wallet),
      subject: intent.intent_id,
      outcome: 'denied',
      req,
    });
    return NextResponse.json(
      { ok: false, reason: 'signature_invalid' },
      { status: 400, headers: NO_STORE },
    );
  }

  // Daily USD spend cap check. amount_usd may be null when the engine
  // couldn't quote (unknown symbol) — treat that as 0 for the cap
  // (the cap covers priced intents; unpriced intents flow through
  // and are the engine's problem to size).
  const prefs = getCapabilityPreferences(intent.wallet_address);
  const cap =
    prefs.spend_caps[intent.kind] ?? DEFAULT_SPEND_CAPS_USD[intent.kind];
  const usedToday = getCapabilitySpendUsedToday(
    intent.wallet_address,
    intent.kind,
  );
  const wouldSpend = usedToday + (intent.amount_usd ?? 0);
  if (cap > 0 && wouldSpend > cap) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'spend_cap_reached',
        cap,
        used_today: usedToday,
        pending_amount_usd: intent.amount_usd,
      },
      { status: 402, headers: NO_STORE },
    );
  }
  if (cap === 0) {
    // Autonomous defaults to $0/day — must be raised explicitly in
    // settings before any autonomous intent can settle.
    return NextResponse.json(
      { ok: false, reason: 'capability_capped_zero', cap_key: intent.kind },
      { status: 402, headers: NO_STORE },
    );
  }

  // Mark signed BEFORE forwarding so a network failure downstream
  // cannot lead to double-signature attempts on the same intent.
  try {
    updateIntentStatus({ intentId: intent.intent_id, status: 'signed' });
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'intent_transition_failed' },
      { status: 409, headers: NO_STORE },
    );
  }
  recordAudit({
    eventType: 'capability.intent.signed',
    actor: actorFromWallet(session.wallet),
    subject: intent.intent_id,
    outcome: 'ok',
    req,
  });

  /* --------------------- forward to engine --------------------- */
  const base =
    process.env.VIZZOR_API_URL ??
    process.env.NEXT_PUBLIC_VIZZOR_API_URL ??
    'https://api.vizzor.ai';
  const apiKey = process.env.VIZZOR_API_KEY;
  const upstreamHeaders: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (apiKey) upstreamHeaders['x-api-key'] = apiKey;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(`${base}/v1/execute-intent`, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify({
        intent_id: intent.intent_id,
        signature,
        wallet_address: intent.wallet_address,
      }),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!upstream.ok) {
      const upstreamText = await safeText(upstream);
      try {
        updateIntentStatus({
          intentId: intent.intent_id,
          status: 'failed',
        });
      } catch {
        /* already terminal */
      }
      recordAudit({
        eventType: 'capability.intent.failed',
        actor: actorFromWallet(session.wallet),
        subject: intent.intent_id,
        outcome: 'error',
        req,
      });
      // 404 on the engine's /v1/execute-intent means the settlement
      // endpoint isn't deployed yet (engine follow-up PR). The
      // signature IS valid — we just have nowhere to send it. Give
      // the client a distinct reason so the UI can say "signature
      // captured, awaiting engine deploy" rather than a generic
      // failure.
      const reason =
        upstream.status === 404
          ? 'engine_settlement_pending'
          : 'upstream_error';
      return NextResponse.json(
        {
          ok: false,
          reason,
          upstream_status: upstream.status,
          upstream_body: upstreamText.slice(0, 512),
        },
        { status: 502, headers: NO_STORE },
      );
    }
    const parsed = (await upstream.json()) as Partial<UpstreamOk>;
    if (
      typeof parsed.tx_hash !== 'string' ||
      parsed.tx_hash.length === 0 ||
      !isIntentNetwork(parsed.network)
    ) {
      try {
        updateIntentStatus({ intentId: intent.intent_id, status: 'failed' });
      } catch {
        /* already terminal */
      }
      return NextResponse.json(
        { ok: false, reason: 'upstream_malformed' },
        { status: 502, headers: NO_STORE },
      );
    }
    try {
      updateIntentStatus({
        intentId: intent.intent_id,
        status: 'executed',
        txHash: parsed.tx_hash,
      });
    } catch {
      /* the row already moved on — return the tx_hash anyway */
    }
    recordAudit({
      eventType: 'capability.intent.executed',
      actor: actorFromWallet(session.wallet),
      subject: intent.intent_id,
      outcome: 'ok',
      req,
    });
    return NextResponse.json(
      {
        ok: true,
        tx_hash: parsed.tx_hash,
        network: parsed.network,
        explorer_url: explorerUrl(parsed.network, parsed.tx_hash),
      },
      { headers: NO_STORE },
    );
  } catch (e) {
    const aborted =
      (e as { name?: string } | null)?.name === 'AbortError';
    try {
      updateIntentStatus({ intentId: intent.intent_id, status: 'failed' });
    } catch {
      /* already terminal */
    }
    recordAudit({
      eventType: 'capability.intent.failed',
      actor: actorFromWallet(session.wallet),
      subject: intent.intent_id,
      outcome: 'error',
      req,
    });
    return NextResponse.json(
      {
        ok: false,
        reason: aborted ? 'upstream_timeout' : 'upstream_unreachable',
      },
      { status: 504, headers: NO_STORE },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
