# RFC — vizzor engine changes for v0.5.1 workflow composition

**Status:** ready to implement in the `vizzor` engine repo
**Coordinated with:** site-vizzor branch `feat/v0.5.0/agent-payments`, this repo
**Deploy order:** engine first, site second — the site's tray shows two capability icons in prod regardless of engine, but the LLM's workflow-narration only kicks in once the engine ships this change

## Context

Site-vizzor v0.5.1 turned the composer into a workflow builder. A prompt like

    predict SOL 4h. send 0.05 SOL to 2X8eKzU9Ky3oYEn4JT6SxPnjtKRDhxHar5BXkWHzvTUN

now BOTH mints a capability intent server-side AND fires `/v1/chat` with the **full prompt** (commands not stripped) plus a `queued_intents` metadata array so the engine's LLM can read the workflow syntax and reference it in its prediction commentary.

The user's course-correction rationale (2026-07-01):

> the vizzor prompt responses might be able to read the structure workflows on the users prompts, so upgrade the engine repo and site vizzor to it

v0.5.1 ships two capabilities and only two: `transfer` (send) and `payment` (coordinar pago). `workflow` and `autonomous` were considered in earlier drafts and have been dropped from both the type system and the code paths — reinstating either is a new PR, not a feature flag. Any reference in this doc to `flow` / `auto` / `create_workflow` / `execute_autonomous` is historical and should be treated as removed.

## Site-side contract (already implemented — reference only)

`POST /v1/chat` request body from `/api/predict/route.ts:388-412`:

```jsonc
{
  "messages": [ /* ...UIMessage[] full history, unchanged shape... */ ],
  "userId": "…",
  "metadata": { "tier": "pro", "wallet": "…", "locale": "es", "timezone": "…", "client": "site-web" },
  "skill_id": "…",                       // optional, unchanged
  "capabilities": ["transfer", "payment"], // v0.5.0, unchanged shape
  "queued_intents": [                    // v0.5.1 — NEW
    {
      "intent_id":  "itn_abc123…",
      "kind":       "transfer",           // CapId
      "symbol":     "SOL",
      "amount":     "0.05",
      "to_addr":    "2X8eKzU9Ky3oYEn4JT6SxPnjtKRDhxHar5BXkWHzvTUN"
    }
  ],
  "wallet_context": {                    // v0.5.1 — NEW
    "wallet":  "…",
    "network": "mainnet-beta" | "devnet" | "testnet",
    "as_of":   1751389200000,             // ms epoch
    "sol":     0.412,                     // may be null on RPC failure
    "spl": [
      { "mint": "…", "symbol": "USDC", "balance": 42.5, "decimals": 6 }
    ]
  }
}
```

The site derives `wallet_context` from `GET /api/wallet/balance` (SIWS-gated). The engine should treat a missing field, a null `sol`, or an empty `spl` as "no balance info available" and NOT fail the request. Verify server-side that `wallet_context.wallet` matches the session wallet before using it in the LLM prompt — the site already asserts this at `/api/predict/route.ts:normalizeWalletContext`, but engine-side re-verification is defense in depth against a compromised proxy.

Hard cap: at most 8 entries in `queued_intents`. The site enforces this in `app/api/predict/route.ts:normalizeQueuedIntents` and rejects anything past the cap silently.

## Engine changes — five slices

### 1. Accept + validate `queued_intents` on `/v1/chat`

File: request-body schema (Zod or equivalent) for `POST /v1/chat`.

Add the optional field:

```ts
queued_intents: z.array(z.object({
  intent_id:  z.string().min(1).max(80),
  kind:       z.enum(['transfer', 'payment']),
  symbol:     z.string().regex(/^[A-Z0-9]{1,16}$/),
  amount:     z.string().regex(/^\d+(?:\.\d{1,18})?$/),
  to_addr:    z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/),
})).max(8).optional(),
```

**Do not** validate against the local intents DB here — the site is the source of truth for freshness/TTL; the engine treats these as advisory context for the LLM.

### 1b. Accept `wallet_context` and use it to ground trade plans

Same request-body schema, additional optional field:

```ts
wallet_context: z.object({
  wallet:  z.string(),
  network: z.enum(['mainnet-beta', 'devnet', 'testnet']),
  as_of:   z.number().int(),
  sol:     z.number().nullable(),
  spl:     z.array(z.object({
    mint:     z.string(),
    symbol:   z.string().nullable(),
    balance:  z.number(),
    decimals: z.number().int(),
  })).max(20),
}).optional(),
```

Then in the LLM prompt assembly:

```ts
if (body.wallet_context) {
  const ctx = body.wallet_context;
  const solLine = ctx.sol === null
    ? '(SOL balance unavailable — RPC unreachable at submit time)'
    : `SOL: ${ctx.sol.toFixed(4)}`;
  const splLines = ctx.spl.length > 0
    ? ctx.spl.map(t =>
        `  ${t.symbol ?? t.mint.slice(0, 6) + '…'}: ${t.balance}`
      ).join('\n')
    : '  (no SPL positions)';
  llmMessages.push({
    role: 'system',
    content: [
      `The user's connected wallet on ${ctx.network} holds:`,
      `  ${solLine}`,
      splLines,
      `Snapshot taken ${new Date(ctx.as_of).toISOString()}. When writing a trade plan, ground amounts in this actual balance ("you have X — this plan uses Y"). Do not propose transfers larger than what the wallet holds; if the user asked for one, warn them explicitly.`,
    ].join('\n'),
  });
}
```

### 2. Inject a system message when `queued_intents` is non-empty

The mental model: the engine's LLM knows what "workflows" are, sees a synthetic system message before the user turn describing the ones queued this turn, and can therefore reference them in its response.

**Regression this section fixes (2026-07):** with only the workflow DSL knowledge and no explicit trust-model pin, the engine's LLM was interpreting `send 0.1 SOL → …` as an agent-side execution request. It then checked its own tool/agent context, found no wallet ("paper trading mode" / "no wallet provisioned") and REFUSED the transfer with a diagnostic like the one below:

> 🚫 **No se puede ejecutar esta transferencia**
> 🔍 DIAGNÓSTICO
> Agente activo: `sol-3h-trader`
> Chain: Solana
> Wallet: **No aprovisionada** (no tiene dirección on-chain asignada)
> Balance: $0
> ⚠️ MOTIVO — El agente está en modo **paper trading** (simulado) …

That refusal is wrong in every situation. The site's transfer flow signs and broadcasts client-side through the user's own Solana wallet adapter — the engine has no wallet, no balance, and no role at execution time. So the "system message injection" MUST pin the trust model explicitly, not just enumerate the queued intents.

Location: wherever the engine assembles the LLM input messages (likely `src/ai/agent/build-messages.ts` or `src/api/routes/v1/chat.ts`). Insert **after** the base system prompt and **before** the user turn:

```ts
if (body.queued_intents && body.queued_intents.length > 0) {
  const lines = body.queued_intents.map((it, i) => {
    const shortAddr = `${it.to_addr.slice(0, 4)}…${it.to_addr.slice(-4)}`;
    return `  ${i + 1}. [${it.intent_id}] ${it.kind} ${it.amount} ${it.symbol} → ${shortAddr}`;
  }).join('\n');
  llmMessages.push({
    role: 'system',
    content: [
      'INTENT_EXECUTION_MODEL: user_wallet_siws',
      '',
      'The user has queued the following capability workflows in this turn:',
      '',
      lines,
      '',
      'Trust model (do not deviate from this):',
      ' - The SITE (site-vizzor) minted each intent under the user\'s SIWS-authed session.',
      ' - The SIGNING happens in the USER\'S OWN wallet client-side (Phantom / Solflare / any Solana wallet adapter).',
      ' - The engine (you) does NOT hold funds, does NOT execute the transaction, and does NOT have an "agent wallet". There is no "paper trading" mode for these intents.',
      ' - Balance checks are the wallet\'s job. If the user lacks funds the wallet extension refuses the signature — the engine never sees it.',
      '',
      'You MUST NOT respond with:',
      ' - "No wallet provisioned" / "no on-chain wallet assigned"',
      ' - "The agent is in paper trading mode"',
      ' - "Cannot execute this transfer" / "no funds available"',
      ' - Any diagnostic implying you must hold or check an agent-side balance.',
      '',
      'Instead: acknowledge the queued action naturally ("your queued transfer to Xyz…5BXk executes in one signature once you approve it in your wallet") and, if the prompt also asked for analysis or a prediction, deliver that too.',
      'Do not restate every field verbatim — the user can already see the intent card.',
    ].join('\n'),
  });
}
```

**Site-side defense in depth:** on 2026-07-02 the site started prepending an equivalent user + assistant priming pair (see `site-vizzor/lib/capabilities/intent.ts:buildIntentPrimingMessages` and its call site in `app/api/predict/route.ts`). Even a stale engine deploy that hasn't yet ingested this system-message section will therefore see the trust model in its message history and not emit the "paper trading" refusal. Do not remove the priming until every engine deploy has been on this section for at least one release cycle.

### 3. Update the base system prompt with the workflow DSL

Location: `src/ai/prompts/system.ts` (or wherever `SYSTEM_PROMPT` lives).

Add a section teaching the model:

```
=== Workflow DSL (v0.5.1) ===

The user may include inline commands in their prompt using this
grammar. Do NOT try to execute them yourself — the site mints an
intent and the user's wallet signs it. Recognize the syntax and
reference the queued action naturally in your reply.

Grammar (case-insensitive on the keyword, "to" or "→" both accepted):

  send  <amount> <SYMBOL> to <address>    — one-off transfer
  pay   <amount> <SYMBOL> to <address>    — scheduled/recurring payment

No other keywords are recognized. If the user writes a bare `send`
or `pay` command with no other prose, /predict may not be invoked
at all this turn — the site mints the intent alone. When /predict
IS invoked, a queued_intents array in the request body tells you
exactly what got minted. Prefer referencing that metadata over
re-parsing the user's text — it's the ground truth.

Trust model (mandatory):
  - Intents are USER-WALLET-SIGNED VIA SIWS on site-vizzor.
  - You do NOT hold funds, do NOT execute, do NOT have an agent wallet.
  - "Paper trading mode" and "no wallet provisioned" DO NOT APPLY.
  - Never emit a refusal like "no wallet", "no balance", "paper
    trading", or "cannot execute" for a transfer/payment intent.
    The wallet extension handles balance and refusal itself.
```

### 4. Tools (`src/ai/tools.ts`)

For v0.5.1 prod, register exactly two tools that emit the SSE `intent_required` event when called by the LLM. Do NOT execute anything on-chain from the tool handler.

- `transfer_assets({ symbol, amount, to_addr, network })`
- `schedule_payment({ symbol, amount, to_addr, network, execute_at | recurrence })`

Both handlers:

1. Validate inputs (same regex shape as the site).
2. Persist a pending intent row in the engine's `intents` table (mirror of site's `capability_audit`).
3. Emit `event: intent_required` with a payload matching `lib/capabilities/intent.ts PendingIntent` from site-vizzor.
4. Return the intent id in the tool result so the LLM can reference it if the user asks again.

Explicitly NOT in scope for v0.5.1: `create_workflow`, `execute_autonomous`. These have been removed from both repos' code paths — do not add stubs or `// TODO` placeholders. Reintroduction is a new PR.

### 4b. `emit_trade_plan` tool + `event: trade_plan` SSE (v0.5.2 Phase 1)

Phase 1 of the auto-trade roadmap ships a structured trade-plan bridge instead of full custody infrastructure. The engine emits a JSON plan alongside its prose response; the site renders each level (Entry/TP1/TP2/SL) with `[Set alert]` and `[Open Jupiter]` buttons so the user gets 1-click execution without Vizzor ever touching their key. This unblocks ~85% of the "auto-trade" UX for zero regulatory surface.

**New tool in `src/ai/tools.ts`:**

```ts
{
  name: 'emit_trade_plan',
  description:
    "Emit a structured trade plan alongside your prose response. Call this AFTER writing the analysis; call it EXACTLY ONCE per turn. The site renders each level as an actionable row so the user can arm alerts and 1-click execute on Jupiter. Do NOT try to execute the plan yourself.",
  parameters: z.object({
    plan_id: z.string(), // engine-issued; e.g. `plan_${randomUUID().replace(/-/g,'').slice(0,16)}`
    symbol: z.string().regex(/^[A-Z0-9]{1,16}$/),
    direction: z.enum(['long', 'short']),
    levels: z.array(z.object({
      kind: z.enum(['entry', 'tp1', 'tp2', 'sl']),
      price: z.number().positive(),
      deltaFromEntryPct: z.number().nullable().optional(),  // 0.02 = +2%
      positionPct: z.number().min(0).max(1).nullable().optional(),
    })).min(1).max(4),
    base_asset: z.string().regex(/^[A-Z0-9]{1,16}$/).nullable().optional(),
    size_base: z.number().positive().nullable().optional(),  // whole units
    horizon_hours: z.number().positive().nullable().optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    issued_at: z.number().int(),
    proceeds_to: z.string().nullable().optional(),  // wallet address for winnings
  }),
  handler: async ({ input, sse }) => {
    sse.emit({ event: 'trade_plan', data: input });
    return { ok: true, plan_id: input.plan_id };
  },
}
```

**SSE event on `/v1/chat` stream:**

```
event: trade_plan
data: {
  "plan_id": "plan_a1b2c3d4e5f6",
  "symbol": "SOL",
  "direction": "long",
  "levels": [
    { "kind": "entry", "price": 77.90, "deltaFromEntryPct": 0.00, "positionPct": null },
    { "kind": "tp1",   "price": 79.46, "deltaFromEntryPct": 0.02, "positionPct": 0.60 },
    { "kind": "tp2",   "price": 81.02, "deltaFromEntryPct": 0.04, "positionPct": 0.40 },
    { "kind": "sl",    "price": 76.34, "deltaFromEntryPct": -0.02, "positionPct": null }
  ],
  "base_asset": "SOL",
  "size_base": 0.5,
  "horizon_hours": 12,
  "confidence": 0.55,
  "issued_at": 1751389200000,
  "proceeds_to": "5oQ2uHV8TFQ1w1cXSotFHdvFiKXQyesuMY2YTLhtb1qL"
}
```

**System-prompt guidance to add:**

```
=== Trade plans (v0.5.2 Phase 1) ===

When you write a trade plan in prose (Entry / TP1 / TP2 / SL levels), you MUST also call `emit_trade_plan` with the same numbers structured as JSON. The site renders that JSON as an in-thread card so the user can (a) arm alerts on each level with one click, (b) open Jupiter to execute the swap.

Rules:
- Call `emit_trade_plan` EXACTLY ONCE per turn. Emitting multiple plans in one turn confuses the UI.
- If the user asked for winnings to be sent to another wallet, populate `proceeds_to`. Do NOT try to send anything yourself — the site mints a transfer intent separately when TP1/TP2 fires.
- `positionPct` on TP1/TP2 defaults to a 60/40 split; override only when the user explicitly asked for a different sizing.
- `size_base` should be grounded in the `wallet_context` snapshot. If the wallet holds 0.5 SOL, don't propose a plan sized for 5.
- If you don't have enough data to write a plan (missing prices, no wallet context, etc.), DON'T call the tool — write prose only.
```

**Site handoff (already implemented in `site-vizzor`):**
- `/api/predict/route.ts` parses `event: trade_plan`, re-emits as `data-trade-plan` in the AI SDK stream.
- `predict-shell.tsx` catches the data-part in `onData`, stores in `tradePlans` map, renders `<TradePlanCard>` in-thread.
- Card issues `POST /api/alerts` per level using the existing `AlertKind` union (`entry|tp1|tp2|sl`) — no engine changes needed for the alert side; the alerts service already handles those kinds.

**Deploy order:** engine ships first. Site's TradePlanCard mounts only when it sees the data-part; a pre-v0.5.2 engine that never emits the event = no card rendered = zero UX regression.

### 5. `POST /v1/execute-intent` — dual-path

Site posts either:

**Client-executed (existing, keep):**
```jsonc
{ "intent_id": "…", "tx_hash": "<solana signature>", "wallet_address": "…" }
```
Engine's job: look up the intent by id, verify wallet ownership, persist `status='executed'` with the tx_hash, return `{ tx_hash, network, explorer_url }`. No signature verification needed — the on-chain tx signature IS the proof.

**SIWS-signed canonical (new, add):**
```jsonc
{ "intent_id": "…", "signature": "<base58>", "wallet_address": "…" }
```
Engine's job:
1. Look up the intent by id; check wallet ownership, `status='pending'`, TTL not expired.
2. Verify `signature` against `intent.canonical` via `nacl.sign.detached.verify`. Reject with 400 `signature_invalid` if it fails.
3. Persist `status='signed'`.
4. Dispatch to `src/core/agent/executors/solana-transfer.ts` (for transfer) or persist to the `payments` table for the scheduler (for scheduled payment).
5. Return `{ tx_hash?, network, explorer_url?, status: 'signed' | 'executed' }`.

Discriminator: `typeof body.tx_hash === 'string'` → client-executed path; else canonical-signature path.

Custody-model note: the SIWS-signed path requires the engine to broadcast the tx on behalf of the user. That means the engine needs one of (a) a custodial hot wallet the user pre-funded, (b) an SPL-token delegate the user pre-authorized, or (c) a deferred queue that waits for the user's own wallet to broadcast. **Pick (a) for v0.5.1 with a clearly-labeled "vizzor treasury" address so legal has a paper trail.** (b) and (c) are follow-ups.

## Chain executors

- **`src/core/agent/executors/solana-transfer.ts`** — SPL + native SOL transfer using `@solana/web3.js` + `@solana/spl-token`. Match the tx shape from `site-vizzor/components/pay/solana-pay-button.tsx` (production-proven).
- **`src/core/agent/executors/payment-scheduler.ts`** — cron. Reads `payments` table, calls `solana-transfer.ts` at `execute_at`. Retry policy: 3 attempts with exponential backoff.

Out of scope: `ton-transfer.ts` (v0.5.2 + TON web watcher work).

## Engine DB — `intents` table

Mirror of site's `capability_audit` (see `lib/payment/db.ts:604-660`):

```sql
CREATE TABLE IF NOT EXISTS intents (
  intent_id      TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK(kind IN ('transfer','payment')),
  network        TEXT NOT NULL CHECK(network IN ('sol','ton')),
  symbol         TEXT,
  amount         TEXT,
  from_addr      TEXT,
  to_addr        TEXT,
  canonical      TEXT NOT NULL,
  nonce          TEXT NOT NULL,
  issued_at      INTEGER NOT NULL,
  ttl_at         INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK(status IN ('pending','signed','executed','failed','expired')),
  tx_hash        TEXT,
  signed_at      INTEGER,
  executed_at    INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intents_wallet_created ON intents(wallet_address, created_at);
CREATE INDEX IF NOT EXISTS idx_intents_status_ttl    ON intents(status, ttl_at);
```

Note the engine does NOT need `conversation_id` — that's site-only for the workflows page grouping.

### 5b. Notifications parity (v0.5.2 — added 2026-07-02)

The site now runs a notifications ledger (`notifications` table, `/api/notifications`) that powers a sidebar unread badge and an auto-narrated Vizzor turn in-chat. Every intent that reaches a terminal state (executed / failed / rejected / expired) already fires a client-side POST to `/api/notifications/emit`, so the badge updates without engine changes. Two OPTIONAL engine additions harden this so the site works even when the user's tab is closed:

**(a) Emit `event: intent_status` when the engine settles an intent server-side.** Applies to the SIWS-signed / scheduled-payment paths where the wallet isn't holding the browser session hostage. Fired once per state transition, on the SSE stream of the wallet's *next* /v1/chat call, so the site can catch up on background settlements.

```
event: intent_status
data: {
  "intent_id": "itn_a1b2c3…",
  "kind": "transfer",
  "symbol": "SOL",
  "amount": "0.05",
  "status": "executed",
  "tx_hash": "…",
  "network": "sol",
  "explorer_url": "https://solscan.io/tx/…"
}
```

Site handoff: `/api/predict/route.ts` should treat this like the other data parts — re-emit as `data-intent-status` and predict-shell drops a `notifications/emit` POST + a synthetic assistant turn on receive. (The site side is a small follow-up; the client-side path already handles executed/failed/rejected/expired for wallet-signed transfers.)

**(b) Emit `event: alert_status` when an engine-side alert fires.** Same reasoning — the site currently detects triggers by diffing `/api/alerts` on a 30s poll (`site-vizzor/lib/notifications/use-alert-trigger-watch.ts`). If the engine emits `alert_status` on the /v1/chat stream at the next user turn, or on the `/v1/notifications` push channel (see (c)), we can drop the polling loop.

```
event: alert_status
data: {
  "alert_id": "alr_…",
  "symbol": "SOL",
  "direction": "above",
  "price": 78.90,
  "status": "triggered",
  "triggered_at": 1751389200000
}
```

**(c) Optional: `GET /v1/notifications` push channel.** Long-poll or SSE endpoint that the site's ProductSidebar can subscribe to. Payload identical to the site's own `notifications` row shape. When available, it replaces the 30s alerts poll entirely. Explicitly out of scope for v0.5.1 — mentioned so we have a clear "where this goes next" line.

None of the above is REQUIRED for the sidebar badge or the in-chat receipt to work — the site handles both today via the client-side emit + poll. These additions turn "works while the tab is open" into "works while the wallet is signed in", which matters for the scheduled-payment case where a transfer can settle hours after the user closed the tab.

## Verification (engine-side)

1. Curl `POST /v1/chat` with a `queued_intents` array; verify the LLM output references the queued action (e.g. mentions "your queued transfer to Xyz…5BXk" when a transfer is in the array).
2. Curl `POST /v1/execute-intent` with `{ intent_id, tx_hash, wallet_address }` — expect `{ ok: true, tx_hash, explorer_url }`.
3. Curl the same with `{ intent_id, signature, wallet_address }` (SIWS-signed path) using a real canonical intent from the site — expect the engine to verify, broadcast via `solana-transfer.ts`, return the on-chain signature.
4. Curl `POST /v1/execute-intent` with a tampered `canonical` string signed by the correct key — expect 400 `signature_invalid`.
5. Verify the tools registry only lists `transfer_assets` + `schedule_payment` in prod; `create_workflow` / `execute_autonomous` are absent.

## Reference — patterns to reuse from site-vizzor

- Canonical intent format: `site-vizzor/lib/capabilities/intent.ts:119-138` (RFC-8785-like sorted-key JSON with `vizzor.intent.v1\n` domain separator).
- ed25519 verification pattern: `site-vizzor/lib/payment/siws.ts:378-395` (`verifySiwsSignatureBytes` — tweetnacl + bs58).
- Solana tx shape: `site-vizzor/components/pay/solana-pay-button.tsx:263-282` — production-proven legacy Transaction with post-hoc property assignment.

## What NOT to change

- Existing SSE event vocabulary (`text`, `token_data`, `tool_use`, `error`, `done`, `conversation`, `intent_required`) — the site's proxy at `/api/predict/route.ts:265+` parses these by name.
- Existing `capabilities` field semantics — the array is still the intersection of UI-armed + DB-enabled and still allow-lists what tools may be invoked.
- Existing free-tier gating on `/v1/chat` — site handles it before forwarding.
