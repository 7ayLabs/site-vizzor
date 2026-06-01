# `api.vizzor.ai` — Site Contract

**Audience:** the team shipping endpoints on the Vizzor product repo
(`github.com/7ayLabs/vizzor`, Fastify API on port `7100`).

**Why this doc exists:** `site-vizzor` (this repo) consumes the product
API at `api.vizzor.ai`. Every endpoint listed here is called by the
site at runtime. Breaking the shape breaks the site. The site has a
fallback for *every* endpoint (committed snapshot, stub generator,
etc.), so a missing endpoint degrades gracefully — but the goal is to
reach a state where the upstream API is the canonical truth and the
fallbacks only kick in during incidents.

All endpoints:
- Live under `https://api.vizzor.ai/v1/site/*`.
- Are publicly cacheable except where noted (no auth required).
- Must respond within **6 seconds** or the site times out and falls
  back. Tune RPC + DB queries accordingly.
- Must set permissive CORS (`Access-Control-Allow-Origin: https://vizzor.ai`).

---

## 1. `GET /v1/site/ticker`

**Status:** Currently *not implemented upstream*. The site proxies
CoinGecko via `/api/ticker` to provide live prices for the carousel.
When this endpoint ships upstream, the site's CoinGecko proxy becomes a
fallback.

**Response:** `TickerEntry[]`
```ts
interface TickerEntry {
  symbol: string;     // e.g. "BTC"
  price: number;      // USD
  changePct: number;  // 24h percent change as decimal, e.g. -0.0652
  source?: string;    // exchange / aggregator that supplied the price
}
```

**Cache hint:** safe to `s-maxage=30, stale-while-revalidate=60`.

---

## 2. `GET /v1/site/tracker-wr`

**Response:** `TrackerWR`
```ts
interface TrackerWR {
  aggregate: { wr: number; samples: number; asOf: string };
  byTier: Record<'high-conviction'|'whale-confirmed'|'tracked'|'advisory', { wr: number; samples: number }>;
  byHorizon: Record<string, { wr: number; samples: number }>;
}
```

Powers the home page's `TrustBecauseTracked` section.

**Cache hint:** `s-maxage=300` (5 min) — recalibration is slow.

---

## 3. `GET /v1/site/last-24h`

**Response:** `Last24h`
```ts
interface Last24h {
  hits: number;
  misses: number;
  neutrals: number;
  pending: number;
  decisiveWR: number; // hits / (hits + misses)
}
```

Powers the live counter in the receipts scorecard.

**Cache hint:** `s-maxage=60`.

---

## 4. `GET /v1/site/recent-predictions`

**Query params:**
- `limit?: number` — default `20`, max `50`
- `tier?: 'high-conviction'|'whale-confirmed'|'tracked'|'advisory'`
- `outcome?: 'hit'|'miss'|'neutral'|'pending'`

**Response:** `Prediction[]` (most recent first).

**Cache hint:** `s-maxage=30`.

---

## 5. `GET /v1/site/prediction/:id`

**Path param:** `:id` is a `Prediction.id` (e.g. `p_5j2k1f`).

**Response:** `Prediction` (full shape with `triggerSnapshot`).

**Cache hint:** if `outcome` is `'pending'`: `no-store`. Otherwise
`s-maxage=3600` (resolved predictions are immutable).

---

## 6. `POST /v1/site/chat` ⭐ **REQUIRED — canonical chat surface**

The Vizzor engine **is** the on-site chat backend. The site is a thin
consumer with no local prediction logic. Every prediction prompt
forwarded from the on-site chat at `vizzor.ai/predict` arrives here.

Until this endpoint is live, the site returns an honest **"⚠ Vizzor
offline"** message to every prediction request. There is no fallback
that fabricates predictions — that's a deliberate decision: the
calibration story (`tracked WR`, receipts, trigger snapshots) collapses
if the site lies when the engine is down.

### Request

```http
POST /v1/site/chat
Content-Type: application/json
Accept: text/event-stream
x-vizzor-burn-tx: <signature?>   // optional, only when paid tier active

{
  "messages": [
    { "id": "m1", "role": "user", "parts": [{ "type": "text", "text": "BTC 4h" }] },
    { "id": "m2", "role": "assistant", "parts": [{ "type": "text", "text": "..." }] },
    { "id": "m3", "role": "user", "parts": [{ "type": "text", "text": "now ETH 1h" }] }
  ]
}
```

The site forwards **raw user input verbatim** — no symbol/horizon
parsing, no language detection. The Vizzor engine handles NLU, locale
inference, command parsing, and content generation. The site's only
contribution is the conversation history (so multi-turn context works).

### Response

The engine returns a **server-sent event stream** in the Vercel AI SDK
**UI Message Stream protocol**:

```
Content-Type: text/event-stream
x-vercel-ai-ui-message-stream: v1

data: {"type":"text-start","id":"<msg-id>"}

data: {"type":"text-delta","id":"<msg-id>","delta":"🟠 BITCOIN · 1h\n💰 BTC Price: $70,976"}

data: {"type":"text-delta","id":"<msg-id>","delta":"\n💵 Direction: 📉 SHORT (67%)\n..."}

data: {"type":"text-end","id":"<msg-id>"}

data: [DONE]
```

The site passes this stream directly to the browser; the `@ai-sdk/react`
`useChat` hook on the client renders it natively. The engine team can
emit this format trivially using the Vercel AI SDK's `streamText()` →
`toUIMessageStreamResponse()` helpers, or write it manually (it's just
SSE with JSON envelopes).

### Content responsibility

The engine emits the **canonical Telegram-bot trade-plan format**:

```
🟠 BITCOIN · 1h
💰 BTC Price: $70,976.28
💵 Direction: 📉 SHORT (58%)
🪙 Entry Zone: $70,976.28 — $71,261.18
📈 TP1: $70,887.05 (-0.13%)
📊 SL: $71,615.07 (+0.90%)
⚠ Skip: R:R 1:0.14 — risk exceeds reward, no trade
```

or for RANGE markets:

```
🟣 SOLANA · 1d
💰 SOL Price: $79.42
💵 Direction: ➖ RANGE (57%)
🪙 Band: $78.74 — $80.10
💹 Best Play: Range fade — long $78.74, short $80.10 (no leverage)
```

The site renders the engine's output verbatim. **Coin glyphs, R:R
calculations, verdict thresholds, locale handling, and signal narratives
are all engine responsibilities.** The site has no `formatPrediction`
code anymore.

### Burn-tx forwarding

When `isTokenLive()` and the visitor presents a verified burn
(checked at the site against the Solana RPC), the site forwards the
`x-vizzor-burn-tx` header to the engine. The engine MAY use this to:
- record the burn for accounting,
- unlock higher-tier signal detail (premium signals not shown to free
  users),
- skip a confidence floor that the free tier applies.

The engine does **not** need to re-verify the burn — the site has
already done it. The header is informational.

### Status codes

| Code | Site behavior |
|---|---|
| `200` + stream | Pass through verbatim. |
| `4xx` / `5xx` / timeout / network error | Return the offline message to the browser. |

### Caching

`no-store`. Streaming responses must not be cached.

### Why streaming (not single-shot JSON)

- Matches the bot's UX — receipts feel kinetic as they materialize.
- The site already has the AI SDK stream protocol wired client-side
  (`useChat`); upstream emitting the same protocol means zero
  transformation at the edge.
- Multi-turn refinements (e.g., "now ETH 1h", "and what about 1d?")
  arrive as additional messages in the array without protocol changes.

---

## 7. `POST /v1/site/burn-context` (optional, future)

When the $VIZZOR token launches and the paid tier activates, the site
will need to call upstream to (a) check the user's recent predict
history for context-aware responses, and (b) attach the burn tx as
proof-of-payment.

This is **not required for Phase 2** — the site's `/api/predict`
already handles burn verification locally via `/lib/solana.ts`. But if
the product team wants to enrich responses based on the burn-paid
user's prior predictions, this endpoint would carry that.

Tracked for v0.2.0.

---

## 8. CORS

All endpoints under `/v1/site/*` must respond with:
```
Access-Control-Allow-Origin: https://vizzor.ai
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Max-Age: 86400
```

The Caddy block in this repo's README already documents this for the
GET endpoints. The `POST /v1/site/predict` addition needs the
`POST` method in the allowlist.

---

## 9. Versioning

The `/v1/` segment is the major version. Breaking changes to any shape
above must bump to `/v2/`. The site's `lib/api.ts` reads
`NEXT_PUBLIC_VIZZOR_API_URL` so swapping the API host (e.g. to point at
a staging server) is a config change, not a code change.

---

## 10. Health probe

The site does **not** call `/v1/site/health` — it has its own
`/api/health` for container probes. But if the product wants its own,
follow the same `{ ok, sha, buildTime, uptime }` shape the site uses.

---

## 11. Implementation priority for the product team

1. **`POST /v1/site/predict`** — unblocks the on-site Vizzor chat
   experience. Highest user-visible impact.
2. `GET /v1/site/ticker` — replaces our CoinGecko proxy with first-party
   data.
3. `GET /v1/site/tracker-wr` — replaces the committed snapshot.
4. The remaining GET endpoints — replaces other snapshot fields one by
   one.

The site can ship and operate with **all** of these missing (falling
back to snapshot + stub). Shipping them progressively upgrades the
fidelity of the on-site experience without coordination overhead.
