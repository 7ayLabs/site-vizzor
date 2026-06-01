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
