/**
 * Agent-payment intent primitives.
 *
 * v0.5.0 introduces four wallet-scoped capabilities the /predict chat
 * can trigger. Every capability produces a "pending intent" first — the
 * engine's tool call NEVER writes on-chain. The site renders a
 * confirmation modal, the user signs a canonical string with their
 * wallet, and only then does a separate settlement route hit the chain.
 *
 * Shape mirrors the X402 payment protocol: challenge → wallet-signed
 * authorization → settlement → response carries tx receipt. The
 * canonical bytes we sign must be byte-identical on the client and on
 * the server (site + engine) — that's the whole point. This file is the
 * single source of truth for that canonicalization.
 *
 * The canonical form is a subset of RFC 8785 JCS: sort object keys
 * lexicographically, no whitespace, ISO strings for numbers we can't
 * safely round-trip (amounts stay as decimal strings). We do not
 * accept floats in amounts — chain math is integer-only (lamports,
 * nanoTON) even when displayed to the user as decimals.
 */

/**
 * The capabilities the user can arm from the composer tray.
 *
 * v0.5.1 shipping scope: `transfer` (send) + `payment` (schedule).
 * Earlier drafts included `workflow` and `autonomous` — both were
 * removed from the union so the engine, DB, and UI can no longer
 * silently accept them. Reinstating either means a new PR, not a
 * feature flag.
 */
export type CapId = 'transfer' | 'payment';

export const ALL_CAP_IDS: readonly CapId[] = ['transfer', 'payment'];

export function isCapId(x: unknown): x is CapId {
  return x === 'transfer' || x === 'payment';
}

/** Which chain the intent settles on. SOL + TON only per v0.4 scope. */
export type IntentNetwork = 'sol' | 'ton';

export function isIntentNetwork(x: unknown): x is IntentNetwork {
  return x === 'sol' || x === 'ton';
}

/** Intent kinds map 1:1 to CapId. */
export type IntentKind = CapId;

/**
 * Server-issued pending intent. Emitted by the engine as an SSE
 * `intent_required` event after a capability tool call. All fields
 * except `network_fee` are required — fee is best-effort at issue time.
 */
export interface PendingIntent {
  intent_id: string;
  kind: IntentKind;
  network: IntentNetwork;
  from_addr: string;
  to_addr: string;
  symbol: string;
  amount: string; // decimal-string, no floats
  network_fee?: string; // decimal-string in native chain unit
  nonce: string;
  ttl_at: number; // unix ms
  issued_at: number; // unix ms
}

/** After the user signs, we ship the signed authorization to the engine. */
export interface SignedIntent {
  intent_id: string;
  signature: string; // base58 for SOL, hex for TON
  signed_by: string; // wallet address that produced the signature
}

/** Response from /api/execute-intent after upstream settlement. */
export interface ExecutedIntent {
  intent_id: string;
  tx_hash: string;
  network: IntentNetwork;
  explorer_url: string;
}

/* ------------------------------------------------------------------ *\
 * Canonicalization
\* ------------------------------------------------------------------ */

/**
 * The exact keys the canonical form covers. Anything the engine adds
 * later that isn't in this list is REFUSED to sign — that's the
 * "unknown field → refuse" security invariant from the plan.
 */
const CANONICAL_KEYS = [
  'amount',
  'from_addr',
  'intent_id',
  'issued_at',
  'kind',
  'network',
  'nonce',
  'symbol',
  'to_addr',
  'ttl_at',
] as const;

type CanonicalKey = (typeof CANONICAL_KEYS)[number];

/**
 * Produce the byte-identical string that gets signed by the wallet.
 * Server and client MUST produce the same bytes given the same input.
 *
 * Format: `vizzor.intent.v1\n<sorted-json>`
 * The prefix is a domain-separator so a signature over an intent can
 * never be replayed as a signature over a different Vizzor message
 * shape (SIWS nonce, share-token, etc.).
 */
export function buildCanonicalIntent(intent: PendingIntent): string {
  const obj: Record<CanonicalKey, string | number> = {
    amount: intent.amount,
    from_addr: intent.from_addr,
    intent_id: intent.intent_id,
    issued_at: intent.issued_at,
    kind: intent.kind,
    network: intent.network,
    nonce: intent.nonce,
    symbol: intent.symbol,
    to_addr: intent.to_addr,
    ttl_at: intent.ttl_at,
  };
  // Sort keys lexicographically → JSON.stringify iterates in insertion
  // order for string keys, so an already-sorted object serializes
  // canonically. No native BigInt, no floats, no whitespace.
  const sorted: Record<string, string | number> = {};
  for (const k of CANONICAL_KEYS) sorted[k] = obj[k];
  return `vizzor.intent.v1\n${JSON.stringify(sorted)}`;
}

/**
 * Human-readable copy string for the intent modal + settings history.
 * NOT the signature target — signing uses `buildCanonicalIntent` only
 * so a wallet-prompt format change never invalidates a stored
 * signature. The two-layer confirmation is:
 *
 *   1. Site modal — user reads the friendly fields, clicks "Sign".
 *   2. Wallet prompt — shows the canonical JSON string; user confirms
 *      the signature.
 *
 * Mirrors standard Web3 flows like Permit2 / EIP-712 where the app
 * renders the structured intent and the wallet displays an opaque
 * canonical form.
 */
export function buildDisplayString(intent: PendingIntent): string {
  const expiresIso = new Date(intent.ttl_at).toISOString();
  const kindLabel = KIND_LABEL[intent.kind];
  const lines = [
    'Vizzor Intent v1',
    '────────────────',
    `Action:   ${kindLabel}`,
    `Network:  ${intent.network.toUpperCase()}`,
    `From:     ${intent.from_addr}`,
    `To:       ${intent.to_addr}`,
    `Symbol:   ${intent.symbol}`,
    `Amount:   ${intent.amount}`,
    ...(intent.network_fee ? [`Fee:      ~${intent.network_fee}`] : []),
    `Nonce:    ${intent.nonce}`,
    `Expires:  ${expiresIso}`,
    `Intent:   ${intent.intent_id}`,
    '',
    'Canonical:',
    buildCanonicalIntent(intent),
  ];
  return lines.join('\n');
}

const KIND_LABEL: Record<IntentKind, string> = {
  transfer: 'Transfer assets',
  payment: 'Coordinate payment',
};

/* ------------------------------------------------------------------ *\
 * Parser — accepts the SSE payload and refuses unknown/extra fields.
 * Any field beyond the known set trips the "unknown field → refuse to
 * sign" guardrail. Missing field → null (caller shows an error).
\* ------------------------------------------------------------------ */

const REQUIRED_FIELDS = [
  'intent_id',
  'kind',
  'network',
  'from_addr',
  'to_addr',
  'symbol',
  'amount',
  'nonce',
  'ttl_at',
  'issued_at',
] as const;

const OPTIONAL_FIELDS = ['network_fee'] as const;

const ALLOWED_FIELDS = new Set<string>([
  ...REQUIRED_FIELDS,
  ...OPTIONAL_FIELDS,
]);

const AMOUNT_RE = /^\d+(?:\.\d{1,18})?$/;
const ADDR_RE = /^[a-zA-Z0-9_-]{16,128}$/;
const SYMBOL_RE = /^[A-Z0-9]{1,16}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const ID_RE = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Safe parser. Returns null (never throws) if the payload is malformed
 * or carries an unknown field. Callers should show an error toast on
 * null rather than blindly opening the modal.
 */
export function parsePendingIntent(raw: unknown): PendingIntent | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  // Reject unknown fields — the wallet prompt would misrepresent them.
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_FIELDS.has(key)) return null;
  }
  for (const key of REQUIRED_FIELDS) {
    if (!(key in obj)) return null;
  }

  const intent_id = obj.intent_id;
  const kind = obj.kind;
  const network = obj.network;
  const from_addr = obj.from_addr;
  const to_addr = obj.to_addr;
  const symbol = obj.symbol;
  const amount = obj.amount;
  const nonce = obj.nonce;
  const ttl_at = obj.ttl_at;
  const issued_at = obj.issued_at;
  const network_fee = obj.network_fee;

  if (typeof intent_id !== 'string' || !ID_RE.test(intent_id)) return null;
  if (!isCapId(kind)) return null;
  if (!isIntentNetwork(network)) return null;
  if (typeof from_addr !== 'string' || !ADDR_RE.test(from_addr)) return null;
  if (typeof to_addr !== 'string' || !ADDR_RE.test(to_addr)) return null;
  if (typeof symbol !== 'string' || !SYMBOL_RE.test(symbol)) return null;
  if (typeof amount !== 'string' || !AMOUNT_RE.test(amount)) return null;
  if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) return null;
  if (typeof ttl_at !== 'number' || !Number.isFinite(ttl_at) || ttl_at <= 0) {
    return null;
  }
  if (
    typeof issued_at !== 'number' ||
    !Number.isFinite(issued_at) ||
    issued_at <= 0
  ) {
    return null;
  }
  if (network_fee !== undefined) {
    if (typeof network_fee !== 'string' || !AMOUNT_RE.test(network_fee)) {
      return null;
    }
  }

  return {
    intent_id,
    kind,
    network,
    from_addr,
    to_addr,
    symbol,
    amount,
    nonce,
    ttl_at,
    issued_at,
    ...(network_fee !== undefined ? { network_fee } : {}),
  };
}

/* ------------------------------------------------------------------ *\
 * UI helpers — used by the intent modal and settings history row.
\* ------------------------------------------------------------------ */

/**
 * Short-format an on-chain address for display. Keeps 4 characters at
 * each end and elides the middle: `abc1…xyz9`. Full address is shown
 * on the second line of the wallet prompt so nothing critical is
 * hidden — this is just the composer/history glance form.
 */
export function shortAddress(addr: string, head = 4, tail = 4): string {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/**
 * Explorer URL for a settled tx. Called by the client after
 * /api/execute-intent returns to render "View on explorer" link.
 * Mainnet-only for now.
 */
export function explorerUrl(
  network: IntentNetwork,
  txHash: string,
): string {
  if (network === 'sol') return `https://solscan.io/tx/${txHash}`;
  return `https://tonviewer.com/transaction/${txHash}`;
}

/**
 * Default per-capability daily USD cap. Modest defaults; users can
 * raise via the settings page after accepting TOS.
 */
export const DEFAULT_SPEND_CAPS_USD: Readonly<Record<CapId, number>> = {
  transfer: 50,
  payment: 50,
};

/* ------------------------------------------------------------------ *\
 * Engine priming for queued intents.
 *
 * Context: on 2026-07 users reported the engine refusing bare
 * `send 0.1 SOL → …` prompts with a "no wallet provisioned / paper
 * trading" diagnostic — the LLM was interpreting the workflow as an
 * agent-side execution request. The site's trust model is the
 * opposite: the SITE mints an unsigned PendingIntent under the
 * user's SIWS session, and the USER'S OWN WALLET (Phantom /
 * Solflare / etc.) signs + broadcasts the transaction. The engine
 * never touches funds. So the engine has no "agent wallet" to check
 * and no "paper trading mode" to fall back to; queued intents are
 * already headed on-chain via the user's key.
 *
 * `buildIntentPrimingMessages` prepends a user + assistant priming
 * pair to the /v1/chat message history whenever `queued_intents` is
 * present. It's defense-in-depth: the engine's own base system
 * prompt should also carry this rule (see RFC), but priming means
 * even a stale engine deploy never emits the wrong refusal.
\* ------------------------------------------------------------------ */

/** Same shape as `directory/runtime.ts:PrimingMessage`. Kept
 *  local so this file has no cross-module deps. */
export interface IntentPrimingMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Minimal projection of `PendingIntent` that the engine needs to
 * narrate a queued action. Kept intentionally different from
 * `PendingIntent` — the priming path never carries wallet addresses
 * or nonces, only the human-facing fields the LLM can reference.
 */
export interface QueuedIntentPriming {
  intent_id: string;
  kind: CapId;
  symbol: string;
  amount: string;
  to_addr: string;
}

export function buildIntentPrimingMessages(
  queued: readonly QueuedIntentPriming[],
): IntentPrimingMessage[] {
  if (queued.length === 0) return [];

  const list = queued
    .map((q, i) => {
      const shortTo = shortAddress(q.to_addr, 4, 4);
      const label = KIND_LABEL[q.kind];
      return `  ${i + 1}. [${q.intent_id}] ${label} — ${q.amount} ${q.symbol} → ${shortTo}`;
    })
    .join('\n');

  const userContent = [
    'INTENT_EXECUTION_MODEL: user_wallet_siws',
    '',
    `I've queued ${queued.length} transaction intent(s) this turn via the site composer's inline syntax:`,
    '',
    list,
    '',
    'Trust model (do not deviate from this in your reply):',
    ' - The SITE (site-vizzor) already minted each intent under my SIWS-authed session and returned an intent_id.',
    ' - The SIGNING happens in MY OWN wallet client-side (Phantom / Solflare / any Solana wallet adapter). The site calls wallet.sendTransaction; the RPC broadcasts.',
    ' - You (the engine) do NOT hold funds, do NOT execute the transaction, and do NOT have an "agent wallet". There is no "paper trading" mode for these intents.',
    ' - Balance checks are the wallet\'s job, not yours. If the user\'s wallet lacks funds the wallet extension refuses the signature — you never see it.',
    '',
    'Therefore you MUST NOT respond with:',
    ' - "No wallet provisioned" / "no on-chain wallet assigned"',
    ' - "The agent is in paper-trading mode"',
    ' - "Cannot execute this transfer" / "no funds available"',
    ' - Any diagnostic implying you must hold or check an agent-side balance.',
    '',
    'Instead: acknowledge the queued action naturally ("your queued 0.1 SOL transfer to …htb1qL will execute in one signature once you approve it in your wallet") and, if the prompt asked for a prediction or analysis alongside the transfer, deliver that too.',
  ].join('\n');

  const assistantContent =
    'Understood. Trust model = user_wallet_siws. Intents are minted by the site and signed by the user\'s own wallet; I don\'t execute or check agent-side balance. I\'ll acknowledge the queued action(s) naturally in my next reply and won\'t emit "no wallet" / "paper trading" refusals.';

  return [
    { role: 'user', content: userContent },
    { role: 'assistant', content: assistantContent },
  ];
}
