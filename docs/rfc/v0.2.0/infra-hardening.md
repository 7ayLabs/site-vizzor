# RFC: v0.2.0 Infra Hardening

Status: Accepted for v0.2.0
Cycle: v0.2.0
Owner: site-vizzor platform engineering (C6)
Companions: `docs/rfc/v0.2.0/architecture.md`, `docs/rfc/v0.2.0/wallet-telegram-binding.md`

---

## 1. Scope

This RFC is the C6 deliverable contract from `BRANCHING.md` §7. It addresses the
production-readiness gaps surfaced during the v0.2.0 audit:

1. Persistent DB volume for the SQLite store backing `lib/payment/db.ts`.
2. Replacement of the public `api.mainnet-beta.solana.com` default in
   `lib/payment/watcher.ts` and `lib/solana.ts` with a dedicated provider
   contract that fails closed in production.
3. Centralized secrets management with a single recommended store and a
   documented rotation procedure (see `docs/ops/secrets.md`).
4. Observability: Sentry route instrumentation gated on `SENTRY_DSN`, and a
   richer `/api/health` payload (DB + snapshot freshness + RPC reachability).
5. Documented rollback procedure for v0.2.0 (see `docs/ops/rollback.md`).
6. CI smoke-test extension that validates `db: 'ok'` and snapshot freshness on
   each deploy.

The compose change itself happens in the adjacent `7ayLabs/vizzor` product
repo's `docker-compose.prod.yml`. The exact snippet the operator should paste
into that file is committed at `docs/ops/site-vizzor-compose-snippet.yml`.
This RFC's diff does not touch that file because it does not live in this repo.

## 2. Gap 1 — persistent SQLite volume

### What we observed

`lib/payment/db.ts` reads `process.env.VIZZOR_SITE_DB` (with a fallback of
`<cwd>/.vizzor/site.db`). In the production container, `cwd` is `/app`, so the
SQLite file lands at `/app/.vizzor/site.db`. The current Dockerfile does not
declare a `VOLUME` for that path, and the compose entry documented in the
README (`README.md` §"Compose entry") does not bind a named volume to
`/app/.vizzor`. Every `docker compose up -d --force-recreate site-vizzor` —
which is the exact command the deploy workflow runs on each push to `main` —
recreates the container with a fresh anonymous overlay filesystem. **Result:
the `subscriptions`, `auth_sessions`, `grants`, and `payment_sessions` tables
are wiped on every deploy.**

This was tolerable in v0.1.0 because the payment subsystem had no live users
yet. In v0.2.0 it is unacceptable: a deploy of an unrelated UI change would
silently log every paid user out and lose their subscription record.

### Proposed fix

Bind a named volume `site-vizzor-db` to `/app/.vizzor` in the compose entry in
the adjacent product repo. The exact YAML lives in
`docs/ops/site-vizzor-compose-snippet.yml`. The fix is operator-applied; the
site code already reads `VIZZOR_SITE_DB` with a sensible default, so no code
change is required.

We also tighten the runbook: any future code path that writes to disk in the
site container must either land under `/app/.vizzor` or declare its own named
volume — anonymous overlay writes are forbidden for persistence-critical state.

### Verification

After the operator applies the snippet:

```
ssh deploy@vps
docker volume inspect site-vizzor-db
docker compose exec site-vizzor ls -la /app/.vizzor
docker compose up -d --force-recreate site-vizzor
docker compose exec site-vizzor ls -la /app/.vizzor   # the DB file persists
```

### Rollback

Revert the compose change in the product repo and `docker compose up -d
--force-recreate site-vizzor`. The container will fall back to an anonymous
overlay, which is the v0.1.0 behavior. No data loss occurs from the rollback
itself; data loss occurs from the recreate after the rollback because the
volume binding is gone. Operators must therefore back up the volume to a
snapshot before reverting:

```
docker run --rm -v site-vizzor-db:/data -v $PWD:/backup alpine \
  tar czf /backup/site-vizzor-db-$(date +%s).tar.gz -C /data .
```

## 3. Gap 2 — Solana RPC defaults to a public, rate-limited endpoint

### What we observed

Both `lib/payment/watcher.ts:54-60` and `lib/solana.ts:58-64` default the
Solana RPC URL to `https://api.mainnet-beta.solana.com` when neither
`SOLANA_RPC_URL` nor `NEXT_PUBLIC_SOLANA_RPC_URL` is set. The watcher polls
this endpoint every 5 seconds (`lib/payment/watcher.ts:33` —
`POLL_INTERVAL_MS = 5_000`) and on each tick calls
`getSignaturesForAddress(treasury, { limit: 50 })` plus a
`getParsedTransaction` per matched signature. The public mainnet-beta endpoint
has a documented rate limit of 100 requests / 10s per IP. Under any meaningful
inbound payment volume the watcher will start hitting 429s, stop confirming
transactions, and silently leave paying users stuck on `pending` past their
session TTL.

### Proposed fix

Keep the fallback chain in dev (`SOLANA_RPC_URL` → `NEXT_PUBLIC_SOLANA_RPC_URL`
→ `https://api.mainnet-beta.solana.com`) so localhost development still works
out of the box. Add a fail-fast startup check that throws a clear error if
`NODE_ENV === 'production'` AND neither env var is set. The check fires in two
places:

- `ensureWatcherStarted()` in `lib/payment/watcher.ts` — before the first tick
  runs.
- `getRpc()` (newly extracted helper around `solanaRpcUrl()`) in
  `lib/solana.ts` — on every burn-verify call.

The watcher's check is the load-bearing one. The site fails to boot the
watcher if production is misconfigured, which is the desired behavior:
better to scream loudly at startup than to silently throttle payment
confirmation under load.

### Recommended providers (not endorsed)

The operator should pick one of the following dedicated providers and set
`SOLANA_RPC_URL` to its HTTPS endpoint:

- **Helius** — generous free tier, good support for token-aware methods.
- **Triton One** — performance-tuned, paid-only.
- **QuickNode** — multi-chain, paid plans with regional pinning.

Selection criteria the operator should weight: rate limits at our expected
QPS, `getParsedTransaction` reliability for SPL token transfers,
geographic latency to the VPS, and outage history. We do not endorse a
specific provider here because the choice is a contract negotiation that
depends on volume forecasts that platform engineering does not own.

### Verification

```
NODE_ENV=production node -e "require('./.next/standalone/server.js')"
# expected: throws "[vizzor-watcher] refusing to start: SOLANA_RPC_URL is unset in production"

SOLANA_RPC_URL=https://example-rpc.invalid pnpm start
# expected: boots, watcher tick logs RPC failures to stderr but does not crash
```

### Rollback

Revert the code change. The fallback to `api.mainnet-beta.solana.com` is
restored. This is the v0.1.0 behavior. Rollback is safe but reintroduces the
risk the fix was designed to remove.

## 4. Gap 3 — secrets storage

### What we observed

v0.2.0 introduces three new server-only secrets:

- `VIZZOR_BOT_SHARED_SECRET` — shared with the Telegram bot for the binding
  routes (RFC §7 of `wallet-telegram-binding.md`).
- `VIZZOR_TREASURY_MNEMONIC` — HD derivation seed (C1, deferred until C4 audit
  clears).
- `SOLANA_RPC_URL` — dedicated provider URL with embedded API key
  (the URL itself is the secret for Helius and friends).
- `SENTRY_DSN` — observability sink (DSN URLs embed an auth token).

Today secrets are distributed by hand: the operator sets them in
`/opt/7aylabs/.env` on the VPS and re-deploys. There is no rotation procedure,
no audit log, and the `.env` file lives at rest unencrypted on the VPS disk.

### Proposed fix

Adopt **1Password CLI** (`op`) as the canonical secrets store, with the env
file on the VPS sourced from `op inject` on each deploy. Rationale:

- The operator already runs 1Password for personal credentials, so onboarding
  cost is zero.
- `op inject` resolves `op://<vault>/<item>/<field>` references inside a
  template file, so the `.env` template can live in version control and the
  resolved values stay in 1Password.
- Rotation is a vault edit plus a re-deploy — no SSH file editing.
- Audit trail is the 1Password access log.

Doppler and Infisical are valid alternatives. The operator can override
this recommendation; the runbook at `docs/ops/secrets.md` documents both the
1Password flow (canonical) and the override path (raw `.env` for emergencies).

### Verification

See `docs/ops/secrets.md` §"Verification" for the full procedure.

### Rollback

Revert to raw `.env` on the VPS. The site code reads `process.env.*` in either
case, so the rollback is operational only — no code change is required.

## 5. Gap 4 — monitoring

### What we observed

The site has no application-level error reporting. The container's healthcheck
reports HTTP 200 on `/api/health` but the payload only includes
`{ok, service, sha, buildTime, uptime, timestamp}` — it does not surface the
state of the DB, the watcher, or the snapshot pipeline. A failure mode like
"the watcher silently stopped confirming payments because the DB lock file
is corrupt" would not page anyone until a user complained.

### Proposed fix

Two complementary changes:

1. **Sentry (`@sentry/nextjs`)** — route instrumentation on `/api/predict`,
   `/api/payment/session`, `/api/payment/session/[id]`, `/api/auth/siws/nonce`,
   and `/api/auth/siws/verify`. Gated on `SENTRY_DSN` env (no-op if unset),
   so dev and CI do not need a DSN. Error events go to Sentry; performance
   tracing is opt-in via `SENTRY_TRACES_SAMPLE_RATE`. Log redaction rules
   live in `docs/ops/secrets.md` §"Log redaction".

2. **Health-summary** — `/api/health` is extended with a `checks` object:

   ```json
   {
     "ok": true,
     "service": "site-vizzor",
     "sha": "<short-sha>",
     "buildTime": "<iso>",
     "uptime": 1234,
     "timestamp": "<iso>",
     "checks": {
       "db": "ok",
       "snapshot": { "ageMs": 4123456, "fresh": true },
       "solanaRpc": { "reachable": true, "checkedAt": <ms> }
     }
   }
   ```

   - `db` runs `SELECT 1` against the SQLite connection. Returns `"ok"` or
     `"unreachable"`. Failure does not flip the top-level `ok` to false (the
     site can serve marketing pages without the payment DB), but the deploy
     workflow's smoke test will fail.
   - `snapshot` reads the mtime of `data/snapshot.json`. `fresh` is true if
     the file is younger than 2 hours (snapshot workflow runs hourly so a
     2-hour budget tolerates one missed run).
   - `solanaRpc` issues a `getSlot` call with a 30s in-process cache so
     `/api/health` does not become a DoS amplifier against the RPC provider.

   The top-level `ok` remains `true` as long as the service itself is
   responsive. Per-check failures are advisory and consumed by the smoke
   test and external monitors.

### Verification

```
curl https://vizzor.ai/api/health | jq '.checks'
# {db: "ok", snapshot: {ageMs: ..., fresh: true}, solanaRpc: {...}}
```

### Rollback

Revert the route change. `/api/health` falls back to the v0.1.0 payload. The
smoke test in `.github/workflows/deploy.yml` is extended in the same PR; if
the route is rolled back without reverting the workflow, the smoke test will
fail and block the next deploy. Co-revert both.

## 6. Cross-cutting rollback considerations

Detailed in `docs/ops/rollback.md`. Summary:

- The persistent volume means rolling back the image does NOT roll back the
  on-disk DB. v0.2.0 schema changes are additive (per the cycle-wide invariant
  in `docs/rfc/v0.2.0/architecture.md` §4 #1), so an older image can read a
  newer DB without crashing.
- The watcher's in-process state (`lastSlot`, the started-once flag) is wiped
  on container recreate. In-flight payment sessions remain in the
  `pending` state until the next watcher tick — acceptable, because the
  next watcher run will resume polling from `lastSlot = null` and walk back
  through the most recent 50 treasury signatures.
- The signature replay cache becomes durable in C4 (`lib/payment/replay-cache.ts`,
  per `docs/rfc/v0.2.0/architecture.md` §2 row "lib/payment/db.ts replay cache table").
  Once durable, restart no longer affects replay protection.

## 7. Out of scope

- The actual compose edit in `7ayLabs/vizzor/docker-compose.prod.yml`. This is
  an operator action documented in `docs/ops/site-vizzor-compose-snippet.yml`.
- Provisioning the 1Password vault, the Sentry project, or the dedicated RPC
  account. These are operator actions documented in `docs/ops/secrets.md`.
- Moving from SQLite to Postgres. Flagged for v0.3.0 in
  `docs/rfc/v0.2.0/wallet-telegram-binding.md` §4.
- Caddy-side rate limiting and header policy. Lives in the Caddyfile, not in
  this repo. Documented separately.
