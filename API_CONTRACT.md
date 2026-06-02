# Vizzor engine integration

How `site-vizzor` consumes the Vizzor product engine. **Not a
prescriptive contract** — this is how the site reads the existing
public surface of the real engine. When the engine adds endpoints the
site can use, the integration extends here.

## TL;DR

The site calls **`POST /v1/chat`** on a running Vizzor instance. That's
the same endpoint the Telegram bot and CLI use. The site is a thin
proxy + protocol adapter:

```
browser  ──POST /api/predict──▶  site  ──POST /v1/chat──▶  vizzor engine
                                          (real engine, same as bot/CLI)
```

The site does **not** generate predictions. The engine does.

---

## Running the engine locally

The Vizzor CLI is published on npm as `@vizzor/cli`. It exposes its
REST API via `vizzor serve`.

```bash
# One-time setup
pnpm install                           # site deps include @vizzor/cli devDep
pnpm exec vizzor setup                 # configure API keys (or use existing config)

# Start the engine alongside the site
pnpm exec vizzor serve --port 7100     # in terminal A
pnpm dev                               # in terminal B (site on :3000 or :3001)
```

In a separate `.env.local`, point the site at the engine:

```
VIZZOR_API_URL=http://localhost:7100
```

That's it. The site auto-detects the running engine and routes all
prediction prompts to it. When the engine is down, the site renders
"⚠ Vizzor offline" instead of fabricating predictions.

### AI provider

The engine uses Anthropic by default but supports Ollama, OpenAI, and
Gemini. The site doesn't care which — the engine handles model
routing. To switch providers at runtime:

```bash
# via API
curl -X PUT http://localhost:7100/v1/provider \
  -H 'content-type: application/json' \
  -d '{"provider":"ollama"}'

# or via CLI inside the TUI
/provider ollama
```

If using Ollama, install models first:

```bash
ollama serve
ollama pull qwen2.5:14b   # or llama3.2, whatever you prefer
```

---

## Endpoints the site consumes

### `POST /v1/chat` — primary

The engine's canonical chat endpoint. SSE streaming with tool use.

**Request** (Vizzor's flat shape):
```json
{
  "messages": [
    {"role": "user", "content": "Predict BTC 4h"},
    {"role": "assistant", "content": "..."},
    {"role": "user", "content": "now ETH 1h"}
  ],
  "conversationId": "<optional UUID for persistence>",
  "userId": "<optional UUID for per-user tool routing>"
}
```

The site translates the AI SDK `UIMessage` shape (`{role, parts: [{type:'text', text}]}`) to this flat shape at the proxy boundary.

**Response** — `text/event-stream` with these event types:

| Event | Data | Site behavior |
|---|---|---|
| `conversation` | `{conversationId}` | drop (not user-facing) |
| `token_data` | `{tokens: [...]}` | drop (engine pre-fetches market data; sent for clients that render live tickers) |
| `text` | `{delta: "..."}` | forward as `text-delta` |
| `tool_use` / `tool_call` | `{name, ...}` | render as `\n[tool-name]` so users see when the engine reaches for live data |
| `tool_result` | `{...}` | drop (engine narrates results via subsequent `text` events) |
| `error` | `{message}` | surface as `⚠ Vizzor engine error: <msg>` so billing / config issues are visible |
| `done` | `{usage?}` | drop; the site emits its own AI SDK `text-end` + `[DONE]` |

The site's `/api/predict/route.ts` does the SSE→AI-SDK transformation
in `transformVizzorStream()`. The browser-side `useChat` hook from
`@ai-sdk/react` consumes the AI SDK protocol natively.

### Snapshot-backed routes (cached, used by local slash commands)

These existed in the older contract and are still consumed by the
local command dispatcher (`/wr`, `/precisions`, `/price`, `/trends`).
They are **optional** — the site falls back to the committed
`data/snapshot.json` if any of these are absent on the engine.

- `GET /v1/site/ticker` → `TickerEntry[]` (24h price snapshot)
- `GET /v1/site/tracker-wr` → `TrackerWR` (aggregate + per-tier + per-horizon WR)
- `GET /v1/site/last-24h` → `Last24h`
- `GET /v1/site/recent-predictions?limit=N` → `Prediction[]`
- `GET /v1/site/prediction/:id` → `Prediction`

These were enumerated in the older contract version of this file; the
shapes are still in `lib/types.ts`. The real engine doesn't expose
`/v1/site/*` yet (it has `/v1/chronovisor/*`, `/v1/market/*`,
`/v1/analysis/*` with different shapes) — when the product team
publishes site-shaped endpoints, the snapshot fallback can be retired.

---

## CORS for production

When the engine deploys at `api.vizzor.ai`, the Caddy block must allow
the site origin on `/v1/chat`:

```caddy
api.vizzor.ai {
  reverse_proxy 127.0.0.1:7100
  @site path /v1/chat /v1/site/*
  header @site {
    Access-Control-Allow-Origin "https://vizzor.ai"
    Access-Control-Allow-Methods "GET, POST, OPTIONS"
    Access-Control-Max-Age "86400"
  }
}
```

But the site doesn't talk to the engine from the browser — its server
route (`/api/predict`) is the proxy, so the request is server-to-server
and CORS is moot. The CORS rules above only matter if a different
client wants to talk to the engine directly from a browser.

---

## Authentication

The current engine doesn't require auth on `/v1/chat` (designed for
local + LAN deploys). When it ships behind auth, the site forwards
whatever header the engine expects (an API key in `Authorization`,
typically) — that's a one-line change in `forwardToVizzor()`.

The `x-vizzor-burn-tx` header (paid-tier burn signature) is already
forwarded; the engine MAY use it to unlock premium signals or skip
free-tier confidence floors. The site doesn't require the engine to
honor it — the burn verification happens on the site side via the
Solana RPC.

---

## 7. Payment + grant endpoints — REQUIRED for `/pay/*` checkout flow

When a visitor clicks a tier cadence CTA on `/pricing` they land on
`/[locale]/pay/[tier]/[cadence]`, which connects a TON wallet and routes
the on-chain payment through these five endpoints. Until the engine
ships them, the site's `NEXT_PUBLIC_ACCEPT_TON_PAYMENTS` flag stays
off and the checkout renders a "payment infrastructure pending" panel
with a fallback to the Telegram bot deep-link.

### `POST /v1/payment/session`

Request:
```json
{
  "tier": "pro" | "elite",
  "cadence": "monthly" | "annual" | "lifetime",
  "chain": "ton" | "solana",
  "token": "native" | "vizzor",
  "amountUsdCents": 999,
  "discountBps": 0
}
```

**Valid (chain, token) combos for Phase 1:**

| chain | token | Phase 1 source | Discount |
|---|---|---|---|
| `ton` | `native` | TON Connect, TON mainnet | `0` (base price) |
| `solana` | `vizzor` | Solana wallet adapter + SPL `transferChecked` | `2500 / 3000 / 3500` (Pro / Elite m+y / Elite lifetime) |

The engine MUST:
1. Independently recompute `discountBps` from its canonical pricing
   table (`pro=2500 any cadence; elite=3000 m+y; elite=3500 lifetime`)
   and reject on mismatch with the site-provided value. Same SQLite-
   overlay hot-tune path applies — when the operator runs
   `/plans discount elite lifetime 4000`, the engine value diverges
   from the site's static table for ~1 deploy cycle. The site's
   constant gets updated in the next release.
2. Independently recompute `amountUsdCents` = base × (10000 − discountBps) / 10000
   from the same table and reject on mismatch.
3. Derive a fresh destination per session:
   - TON: HD address from `VIZZOR_PAYMENT_HD_MASTER` mnemonic (server-only).
   - Solana-$VIZZOR: pre-derived treasury ATA from the engine's fixed
     `VIZZOR_TREASURY_OWNER` Solana keypair (the site sends payments
     to this fixed ATA; the memo program instruction carries the
     session ID for disambiguation since the ATA is shared).
4. Snapshot the current USD-to-token rate (CoinGecko for TON;
   Jupiter / Birdeye for $VIZZOR — the engine MAY proxy this through
   its own `/v1/market/price/VIZZOR` endpoint).
5. Persist a `payment_sessions` row with `status='pending'` and
   `expiresAt = now + paymentRateLockSeconds` (default 5 minutes).
6. Return the full session record:

```json
{
  "sessionId": "ses_<uuid>",
  "destAddress": "UQ...xyz | base58SolanaATA",
  "amount": 4.67,
  "decimals": 9,
  "amountUsdCents": 999,
  "tier": "pro",
  "cadence": "monthly",
  "chain": "ton",
  "token": "native",
  "rateLocked": 2.14,
  "discountBps": 0,
  "expiresAt": 1780355499304,
  "status": "pending"
}
```

For $VIZZOR-pay sessions, `destAddress` is a base58 Solana ATA, and
the site's `<VizzorPayButton>` builds an SPL `transferChecked` +
Memo program instruction. The memo data is the raw `sessionId` string
so the watcher daemon can match incoming txs to pending sessions even
when the destination ATA is shared across users.

### `GET /v1/payment/session/:id`

Returns the same shape. While `status='pending'`, the TON watcher
daemon is polling the chain for an incoming transaction to
`destAddress` matching `amountTon ± 0.5%`. Once detected:

```json
{
  ...,
  "status": "confirmed",
  "txSig": "<base64 tx hash>",
  "confirmedAt": 1780355401234
}
```

If `expiresAt` elapses before a tx is detected, status flips to
`"expired"`. If the tx amount is wrong or the dest mismatched, the
watcher logs and the session stays `"pending"` until expiry (no
"failed" terminal state — silent expiry is safer than refund logic).

### `POST /v1/grants`

Request:
```json
{ "sessionId": "ses_<uuid>" }
```

Idempotent: if a grant already exists for this session, return it.
Otherwise mint a new grant code (UUIDv4) with `ttl=24h, singleUse=true`,
linked to the session. Returns:

```json
{ "code": "<uuid>" }
```

### `GET /v1/grants/:code/status`

Used by the bot's `/start grant_<code>` handler to validate before
redemption. Returns:

```json
{
  "valid": true,
  "sessionId": "ses_<uuid>",
  "tier": "pro",
  "cadence": "monthly",
  "expiresAt": 1780441801234
}
```

Or `{ "valid": false, "reason": "expired" | "redeemed" | "unknown" }`.

### `POST /v1/grants/:code/redeem`

Atomic. Body:
```json
{ "telegramUserId": 1234567890 }
```

On success:
1. Mark grant `redeemed` with `redeemedBy` + `redeemedAt`.
2. Create a `subscriptions` row: `(telegramUserId, tier, cadence, expiresAt)`.
3. Extend `runtime-allowlist.grant(telegramUserId, expiresAt)`.
4. Schedule expiry reminders (T-3d / T-1d / T-0).
5. Return the new subscription record.

If the grant is already redeemed or expired, return 409 / 410 with a
clear reason.

### Solana-$VIZZOR watcher daemon (background process)

Mirrors the TON watcher. Polls Solana mainnet via
`connection.getSignaturesForAddress(VIZZOR_TREASURY_ATA, ...)` every
~5 seconds. For each new signature, parses the transaction and looks
for:
- A `spl-token transferChecked` instruction whose `destination` matches
  the treasury ATA and whose `mint` matches `$VIZZOR_MINT`.
- A Memo program instruction whose data decodes to a UTF-8 string
  matching a pending `session.sessionId`.
- Token amount within `±0.5%` of the session's expected `amount`.
- Tx block time `<= session.expiresAt`.

On match: `UPDATE payment_sessions SET status='confirmed', txSig=$1, confirmedAt=now() WHERE id=$2`.

The treasury ATA is **shared** across all users (unlike TON where each
session gets a unique HD-derived address). The memo+amount combo is
the disambiguation key. Pre-flight check: if two pending sessions for
the same tier+cadence have the same expected amount AND no memo
match found, log the conflict and don't auto-resolve.

### TON watcher daemon (background process)

Runs independently of the API workers. Polls TON mainnet every 5
seconds (TonClient `getTransactions(destAddress, fromLt)`). For each
pending session, checks if a matching tx has arrived. Match criteria:
- `destination == session.destAddress`
- `amount` in `[session.amountTon * 0.995, session.amountTon * 1.005]`
  (±0.5% slippage tolerance for FX drift between rate lock and signing)
- `timestamp <= session.expiresAt`
- Either: tx `comment` includes `session.sessionId` (preferred —
  written via the `encodeCommentPayload` helper in the site's
  `ton-connect-button.tsx`), OR the dest address is unique enough that
  amount+address alone disambiguates.

On match: `UPDATE payment_sessions SET status='confirmed', txSig=$1, confirmedAt=now() WHERE id=$2`.
The site's poll picks up the new status on the next 3-second tick.

### Bot `/start grant_<code>` handler

Telegram sends the bot `/start grant_<uuid>`. The bot:
1. Calls `GET /v1/grants/:code/status`.
2. If valid, calls `POST /v1/grants/:code/redeem { telegramUserId }`.
3. DMs the user: "Pro Monthly active until 2026-07-01."
4. If invalid: "This redemption link is expired or already used."

### Env vars (engine-side)

| Var | Purpose |
|---|---|
| `VIZZOR_PAYMENT_HD_MASTER` | BIP-39 mnemonic for TON HD wallet derivation. Server-only. Never reaches the browser. |
| `TON_RPC_URL` | TonCenter or LiteServer endpoint for the TON watcher. |
| `TON_API_KEY` | TonCenter API key if applicable. |
| `VIZZOR_TREASURY_KEYPAIR` | Solana keypair (json-array form) owning the treasury ATA that receives all $VIZZOR-pay subscriptions. Server-only. |
| `VIZZOR_MINT` | Solana mint address of the $VIZZOR token (same as `NEXT_PUBLIC_VIZZOR_MINT` on the site). |
| `SOLANA_RPC_URL` | Solana mainnet RPC for the $VIZZOR watcher. |
| `PAYMENT_RATE_LOCK_SECONDS` | Default 300. Must match the site's `NEXT_PUBLIC_PAYMENT_RATE_LOCK_SECONDS`. |

### Env vars (site-side, $VIZZOR-pay path)

| Var | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_ACCEPT_VIZZOR_PAYMENTS` | public | Build-time gate for the $VIZZOR-pay path. Independent of the TON flag. |
| `NEXT_PUBLIC_VIZZOR_MINT` | public | Already used by the predict-surface burn flow. Shared with the $VIZZOR-pay button for ATA derivation. |
| `NEXT_PUBLIC_VIZZOR_MOCK_USD` | public, dev-only | Override the $VIZZOR/USD rate for local development (e.g. `0.05`). Production reads from the engine's market endpoint instead. |

---

## Fallback policy

The site has **no local prediction logic**. When the engine is down or
returns 5xx, the site streams an honest "⚠ Vizzor offline" message and
doesn't burn the user's free credit. There is intentionally no
local stub — fabricating predictions while the engine is offline would
poison the calibration story the product depends on.

For development without the real engine, run `pnpm mock` to start a
deterministic placeholder server at `:7100` that conforms to the same
SSE protocol. It's labelled `x-vizzor-source: mock` so you can tell
mock responses apart from real-engine responses at a glance.
