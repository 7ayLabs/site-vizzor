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

## 6. `POST /v1/site/predict` ⭐ **NEW (required by Phase 3 of /predict surface)**

This is the **on-site chat surface backend**. The site forwards parsed
prompts here from `/api/predict`. Until this endpoint ships, the site
falls back to: (a) Anthropic Claude if `ANTHROPIC_API_KEY` is set, then
(b) a deterministic local stub. Once shipped, this becomes the canonical
prediction source.

### Request

```http
POST /v1/site/predict
Content-Type: application/json

{
  "symbol": "BTC",
  "horizon": "4h",
  "locale": "en"   // optional, "en"|"es"|"fr"; affects prose lines only
}
```

The site's `parseUserMessage()` extracts `symbol` and `horizon` from the
user's free-text prompt (handles `BTC 4h`, `Predice BTC en 1hr`,
`Prédire ETH en 1d`, etc.). The upstream does **not** need NLU — it
gets pre-parsed structured input.

### Response

A single `Prediction` JSON object:

```ts
interface Prediction {
  id: string;
  symbol: string;
  chain?: 'ethereum'|'polygon'|'arbitrum'|'optimism'|'base'|'bsc'|'avalanche'|'solana'|'sui'|'aptos'|'ton';
  horizon: string;           // "5m"|"15m"|"30m"|"1h"|"4h"|"1d"|"7d"|"30d"|...
  direction: 'up'|'down'|'sideways';
  confidence: number;        // [0, 1]
  tier: 'high-conviction'|'whale-confirmed'|'tracked'|'advisory';
  emittedAt: string;         // ISO 8601
  entryPrice: number;
  predictedPrice: number;
  targets: { bull: number; base: number; bear: number };
  triggerSnapshot: {
    vizzorTa: {
      vote: -1 | 0 | 1;
      signals: SignalContribution[];   // exactly 6, one per family
    };
    smc: { vote: -1|0|1; details: string };
    ict: { vote: -1|0|1; details: string };
    flattenedReason: string;
  };
}

interface SignalContribution {
  family: 'onChain'|'mlEnsemble'|'logicRules'|'patternMatch'|'predictionMarkets'|'socialNarrative';
  cf: number;                 // calibrated CF in [-0.85, 0.85]
  direction: 'up'|'down'|'sideways';
  meta?: Record<string, number | string>;
}
```

### Status codes

| Code | Meaning |
|---|---|
| `200` | Prediction returned. |
| `404` | Unknown symbol or unsupported horizon. The site falls back to its local generator. |
| `429` | Rate limited. The site fall back **and** logs. |
| `5xx` | The site falls back. |

### Cache hint

`no-store` (per-request prediction).

### Format expectation

The site formats the returned `Prediction` via `formatPredictionText()`
into the Helios-style text receipt. The upstream does **not** need to
worry about rendering — just return the structured object.

### Why a single shape (not chat-style streaming)

- Predictions are atomic. Streaming them token-by-token would expose
  intermediate signals that aren't yet calibrated.
- The site already handles SSE streaming to the browser internally —
  it chunks the formatted text to feel kinetic, but the engine call is
  request/response.
- Keeps the contract simple and easy to mock/test.

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
