# RFC: Web3 Purchase Flow Hardening — HD Derivation, TON Watcher, Idempotency, Rate-Cache Resilience

Status: Accepted for v0.2.0
Cycle: v0.2.0
Sub-branch: `feature/v0.2.0/web3-purchase-flow`
Owner: site-vizzor data-integrity engineering
Companions: `docs/rfc/v0.2.0/architecture.md`, `docs/rfc/v0.2.0/wallet-telegram-binding.md`

---

## 1. Scope

This RFC defines the v0.2.0 hardening of the on-site purchase pipeline that v0.1.0 shipped as a minimum-viable surface. It is the design contract for sub-branch C1 in the v0.2.0 cycle and the load-bearing input for C4's security audit.

### In-scope

1. **HD address derivation per session.** Replace the fixed-address treasury model (`lib/payment/treasury.ts:7-12` flags this as Phase 2) with deterministic per-session addresses derived from a single mnemonic. The `payment_sessions.dest_address` column already supports per-row addresses; this RFC ships the derivation that fills it.
2. **TON watcher parity with the Solana watcher.** v0.1.0 ships only `lib/payment/watcher.ts` (Solana). The TON path is currently a documented gap. v0.2.0 ships `lib/payment/watcher-ton.ts` mirroring the Solana watcher's shape, with TON-specific extraction logic (transfer comment as memo, jetton master vs native TON disambiguation).
3. **Idempotency on `POST /api/payment/session`.** Today the route mints a fresh session every call. A double-click or browser retry creates two pending sessions for the same intent; the user pays one, the other expires, the UI may attach to the wrong one. v0.2.0 adds a deterministic dedupe key with a sliding TTL.
4. **Rate-cache resilience.** `lib/payment/rates.ts` today depends solely on CoinGecko (TON) and the engine's `/v1/market/price/VIZZOR` (VIZZOR). When the upstream fails, `getRate` returns `null` and the session route returns `503 rate_unavailable`. v0.2.0 adds a documented fallback chain with a persistent last-known-good store.
5. **Session expiry sweeper.** Today expiration is lazy: `expireStaleSessions` runs only on `GET /api/payment/session/[id]`. A session that no client ever polls remains `pending` indefinitely. v0.2.0 sweeps on the watcher tick so DB state matches reality regardless of client traffic.
6. **Failure-mode catalog extension.** Each new failure surface gets an entry in the cross-cycle catalog (`docs/rfc/v0.2.0/architecture.md` §6).

### Out-of-scope

- Postgres migration of the site DB (deferred to v0.3.0 per architecture RFC §4).
- Refunds, auto-renewal, multi-recipient HD trees (deferred to v0.4.0).
- Replacing the treasury key custody model (audited by C4, not designed here).
- The full SIWS replay-protection audit (owned by C4).
- Telegram-binding routes (owned by C2 in `wallet-telegram-binding.md`).

### Load-bearing seam with C2

C1 consumes C2's `wallet_links` read path. After `finalizeSession` confirms a payment, the Solana watcher and the new TON watcher both look up `findWalletLinkByWallet(payer_address)` (C2 helper). If a pre-link exists, the watcher writes `subscriptions.telegram_user_id` at insert time so the bot sees the subscription on the next `/api/subscriptions/lookup`. The merge order in `architecture.md` §3 places C2 before C1 for this reason. If C1 lands before C2 by exception, C1 ships the lookup as a no-op stub (`async () => null`) and a follow-up commit lights it up after C2 merges.

## 2. Design — HD derivation (`lib/payment/hd.ts`)

### Decision

Adopt BIP-32/BIP-39/BIP-44 HD derivation for Solana and TON addresses. One master mnemonic per environment, stored as `VIZZOR_TREASURY_MNEMONIC`. Per-session derivation index is monotonically allocated from a new `payment_sessions.derivation_index` column (additive, populated by `createSession`).

### Derivation paths

| Chain  | Path                          | Notes                                                                                          |
| ------ | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Solana | `m/44'/501'/<index>'/0'`      | SLIP-0044 coin type 501 for Solana; canonical Phantom/Solflare path. Hardened indices only.    |
| TON    | `m/44'/607'/<index>'`         | SLIP-0044 coin type 607 for TON; matches Tonkeeper / Tonhub default derivation path.            |

Index allocation is a single auto-incrementing counter (`derivation_index INTEGER`) on `payment_sessions`. SQLite's `AUTOINCREMENT` semantic guarantees monotonicity per row insert. We do NOT reuse indices across sessions even if the prior session expired — re-use breaks the audit trail and complicates incident response.

### Library

Add `@scure/bip32` and `@scure/bip39` as `dependencies`. These are zero-dep, well-audited (Paul Miller's scure-suite), already transitively present via `@noble/curves` which we ship today. The TON address encoding step uses `@ton/crypto` (and `@ton/ton` for the friendly-address helper). All HD-derivation imports are lazy and dynamic (`await import('@scure/bip32')`) so the modules load only on a code path that needs derivation. This keeps the cold-start cost off requests that hit the fixed-treasury fallback.

### Public surface

```ts
// lib/payment/hd.ts (skeleton — full implementation in this branch)

export interface SolanaDerivedKey {
  publicKey: string;        // base58 wallet address
  privateKeyBytes: Uint8Array; // 32-byte ed25519 seed (server-only, never logged)
}

export interface TonDerivedKey {
  friendlyAddress: string;  // EQ...-style base64url friendly address
}

export async function deriveSolanaAddress(
  masterMnemonic: string,
  sessionIndex: number,
): Promise<SolanaDerivedKey>;

export async function deriveTonAddress(
  masterMnemonic: string,
  sessionIndex: number,
): Promise<TonDerivedKey>;
```

### Determinism contract

For a fixed mnemonic + index pair, the returned address is byte-identical on every invocation across processes, hosts, and Node versions. This is the basis for the unit-test stub in `tests/payment/hd.test.ts`: a known mnemonic + index 0 yields a known address, and the test asserts byte equality.

### Failure-mode gating

`VIZZOR_HD_DERIVATION_ENABLED` (default `false`) gates the entire HD path. When disabled or when the mnemonic is unset or invalid, `createSession` falls back to the fixed treasury address from `lib/payment/treasury.ts`. The fallback is fail-closed for security: an invalid mnemonic does NOT cause the route to 500. It logs at warn level (no mnemonic content), records `payment_sessions.dest_address` as the fixed treasury, leaves `derivation_index` `NULL`, and the watcher falls back to the v0.1.0 memo-disambiguation path. This is the safety floor.

### Audit deferral

C4 owns:
- Where the mnemonic lives (managed-secret-store migration is C6, but the audit is C4).
- Whether the private-key bytes derived for Solana ever leave the watcher's address space (today: no — derivation is one-shot and the bytes are zeroed after use; C4 verifies this).
- Whether the index counter is observable from any external surface (today: no — it is a DB-internal field, not surfaced in API responses).

## 3. Design — TON watcher (`lib/payment/watcher-ton.ts`)

### Architectural shape

Mirror of `lib/payment/watcher.ts`. Same module-level idempotency (`Symbol.for('vizzor.payment.watcher-ton')`), same poll cadence (5s default, env-tunable), same fire-and-forget `tick()` loop, same `pollOnce()` shape, same `finalizeSession()` semantics. A reader who understands one watcher should understand the other in under a minute.

### TON-specific extraction

- **RPC client.** `@ton/ton` provides `TonClient` (HTTP-based) and `TonClient4` (LiteServer-based). v0.2.0 ships `TonClient` against `VIZZOR_TON_RPC_URL` (default `https://toncenter.com/api/v2/jsonRPC`; dedicated provider in production per C6). Switch to `TonClient4` is a one-line change deferred until throughput demands it.
- **Treasury query.** `client.getTransactions(treasuryAddress, { limit: 50, lt, hash })`. The cursor (`lt`, `hash`) is the TON equivalent of Solana's `lastSlot` — we stash it on the globalThis state object and never re-process the same tx twice.
- **Match algorithm.** For each transaction:
  - `in_msg.source` is the payer address (TON equivalent of Solana's pre/post-balance derivation).
  - `in_msg.value` is the paid amount in nanoTONs (divide by 10^9 to compare against `session.amount`).
  - `in_msg.message` is the comment field; we extract a UTF-8 string and match against `session.session_id` (the canonical memo).
  - Amount comparison reuses the same ±0.5% slippage tolerance as the Solana watcher (`SLIPPAGE_TOLERANCE = 0.005`).
- **Jettons vs native.** v0.2.0 ships native-TON support only (`chain='ton', token='native'`). The route validates `chain:token` as `'ton:native'`, so jetton support is a future RFC. The match algorithm is gated on `s.chain === 'ton' && s.token === 'native'`.

### Public surface

```ts
// lib/payment/watcher-ton.ts (skeleton)

export function ensureTonWatcherStarted(): void;
```

`ensureTonWatcherStarted` is called from the same code paths that call `ensureWatcherStarted` (Solana): `app/api/payment/session/route.ts:POST` and `app/api/payment/session/[id]/route.ts:GET`. The two are independent — a TON-RPC outage does not affect Solana confirmation.

### Restart determinism (cycle-wide invariant #8)

Confirming the same `(session_id, tx_hash)` twice produces zero side effects: `markSessionConfirmed` is a `WHERE status='pending'` guarded `UPDATE`, and `insertSubscription` is followed by a future-RFC dedupe pass (today: `INSERT` is unguarded — the watcher's own state cursor prevents double-processing within a process; cross-process safety is the responsibility of the LRU replay cache C4 will ship in `lib/payment/replay-cache.ts`). C1 does NOT introduce a new replay cache; it relies on C4's durable cache for cross-restart safety.

## 4. Design — Idempotency on `POST /api/payment/session`

### Dedupe key

```
key = sha256(
  tier + '|' + cadence + '|' + tokenHash + '|' + chain + '|' + cookieSessionId
).toString('hex')
```

Where:
- `tier`, `cadence`, `chain`, `token` come from the request body (already validated).
- `tokenHash` is `sha256(token).slice(0, 16)` — guards against any future per-token disambiguation while keeping the key short.
- `cookieSessionId` is the value of a new `vizzor.session` cookie minted on first hit and persisted for 30 days (HttpOnly, SameSite=Strict). This binds dedupe to the browser session, not to the IP, so users behind shared NAT do not collide.

### Window

60 seconds. Within this window, identical `(tier, cadence, chain, token, cookieSessionId)` calls return the existing `payment_sessions` row instead of minting a new one. Past 60 seconds we mint a new session — the rate lock has either confirmed or expired and the user intent should yield a fresh quote.

### Persistence

New SQLite table:

```sql
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key          TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (session_id) REFERENCES payment_sessions(session_id)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_created
  ON idempotency_keys(created_at);
```

The table is purged by the same sweeper that handles session expiry (next section): rows older than 5 minutes are deleted (idempotency window is 60s, so 5min is generous slack and lets us inspect recent rows during incident response).

### Public surface

```ts
// lib/payment/idempotency.ts (skeleton)

export interface IdempotencyInput {
  tier: string;
  cadence: string;
  chain: string;
  token: string;
  cookieSessionId: string;
}

export function computeIdempotencyKey(input: IdempotencyInput): string;

export function findRecentSessionByKey(
  key: string,
  ttlMs: number,
): string | null; // session_id or null
```

### Route wiring

`app/api/payment/session/route.ts:POST`:
1. Read or mint the `vizzor.session` cookie. (Cookie reading is `await cookies()` per Next 15 dynamic-API convention.)
2. Compute `key = computeIdempotencyKey({ tier, cadence, chain, token, cookieSessionId })`.
3. Look up `findRecentSessionByKey(key, 60_000)`. If hit: fetch the row via `getSessionRow(sessionId)` and return it as the success response. If miss: proceed to `createSession()`.
4. On successful `createSession()`: insert into `idempotency_keys (key, session_id)` so the next dedupe hit returns this row.

If step 3 finds a session that has since been confirmed or expired, we still return it. Returning the existing row is the contract; the UI is responsible for updating its state on the GET-poll route.

### Why a cookie, not an IP

IP-based dedupe collides for shared-NAT users (corporate, mobile carrier, VPN). Cookie-based dedupe binds to a browser session, which is the actual user-intent surface. Cookies require no PII storage on our side — the cookie value is a random 16-byte base64url string with zero correlation to user identity.

### Backward compatibility

The route remains backward-compatible: clients that do not send a cookie still get a new session every call (the cookie is server-minted on the response, so the first call always mints; subsequent calls within 60s of an identical intent get the dedupe).

## 5. Design — Rate-cache resilience (`lib/payment/rates.ts`)

### Today's behavior

`getRate(token)` checks an in-memory cache (60s TTL), fetches CoinGecko (TON) or engine /v1/market/price (VIZZOR) on miss, and falls back to the stale cache entry on fetch failure. If the in-memory cache is cold (process just started) AND the upstream is down, `getRate` returns `null` and `POST /api/payment/session` returns `503 rate_unavailable`. This is a single-point-of-failure on every cold start.

### v0.2.0 fallback chain

```
1. In-memory cache (60s TTL)               — already implemented
2. Primary upstream (CoinGecko / engine)   — already implemented
3. Secondary upstream                       — NEW
4. Stale in-memory cache                    — already implemented (stale-while-error)
5. Persisted last-known-good (rate_cache)   — NEW
6. null                                     — only if all fail
```

### Secondary upstream

For TON: CoinMarketCap (`https://api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=TON`, free tier, requires `COINMARKETCAP_API_KEY`). For VIZZOR: the engine's `/v1/market/price/VIZZOR` is already the fallback for a future Jupiter/Birdeye primary; in v0.2.0 we leave it as the only upstream for VIZZOR since the engine itself aggregates.

The chain is configurable via `VIZZOR_RATE_FALLBACK_PROVIDERS` (`'coingecko,coinmarketcap'` default) so ops can reorder without a deploy.

### Persisted last-known-good

New SQLite table:

```sql
CREATE TABLE IF NOT EXISTS rate_cache (
  token        TEXT PRIMARY KEY,
  usd_per      REAL NOT NULL,
  fetched_at   INTEGER NOT NULL,
  source       TEXT NOT NULL
);
```

On every successful fetch, `getRateWithFallback` upserts the row (`INSERT OR REPLACE`). On total upstream failure, it reads the row and returns it tagged as `stale`. The session route accepts a stale rate but flags `payment_sessions.rate_source = 'stale_<source>_<age_seconds>'` (this is a free-form text column we will add additively) so finance can reconcile if a paid session used a stale quote.

### Staleness boundary

A persisted rate older than 1 hour is treated as not-good-enough: `getRateWithFallback` returns `null` rather than a 1-hour-stale rate. The user sees `503 rate_unavailable` and a clear UI banner; the watcher does not silently accept a wildly stale quote. The boundary is tunable via `VIZZOR_RATE_STALE_CEILING_MS` (default `3_600_000`).

### Public surface

```ts
// lib/payment/rates.ts (extension)

export interface RateWithProvenance extends CachedRate {
  source: 'coingecko' | 'coinmarketcap' | 'engine' | 'persisted-stale';
  isStale: boolean;
}

export async function getRateWithFallback(
  token: PriceToken,
): Promise<RateWithProvenance | null>;
```

`getRate` is preserved as a thin wrapper over `getRateWithFallback` for backward compatibility with `lib/payment/session.ts:122`. Callers that need provenance switch to `getRateWithFallback` over time.

## 6. Design — Session expiry sweeper

### Today

`expireStaleSessions(now)` is called only inside `getSession(id)` (`lib/payment/session.ts:180`). A pending session that no client polls remains `pending` in the DB until something else triggers the sweep. Stale-pending rows are visible to `listPendingSessions`, which causes the Solana watcher to repeatedly query a dead session's memo.

### v0.2.0

Piggyback the sweep on the watcher tick. Both `watcher.ts` and `watcher-ton.ts` call `expireStaleSessions(Date.now())` at the top of each `pollOnce()`. Cost: one SQLite `UPDATE` per 5-second tick. Benefit: pending rows match reality continuously; the watcher's filter (`listPendingSessions` already returns `expires_at > now`) becomes truly authoritative.

The idempotency-key purge piggybacks on the same tick:

```sql
DELETE FROM idempotency_keys WHERE created_at < ?;  -- now - 5min
```

These two sweeps are wrapped in a single transaction inside a new `lib/payment/sweeper.ts` (or inlined inside the watcher modules — implementation can choose; the contract is "runs every 5 seconds in process"). The sweeper is NOT exposed as an HTTP route; ops who want a manual sweep run the existing process-level operations.

### Why not a separate `setInterval`

A separate timer adds a second concurrency dimension (the watcher tick + the sweeper tick), increases the surface for race conditions on test setup/teardown, and provides no operational benefit. Piggybacking is the simpler design.

### What if both watchers are disabled

If `acceptVizzorPayments()` and `acceptTonPayments()` are both false, neither watcher runs, so the piggybacked sweep never runs. In that mode there are no payment sessions being created either (the POST route returns `feature_disabled`), so stale rows accumulate at zero rate. This is acceptable. If a partial-flag mode is ever introduced where sessions are created without a watcher, this RFC requires a stand-alone sweeper at that time.

## 7. Failure-mode catalog updates

The following entries extend the cycle catalog at `docs/rfc/v0.2.0/architecture.md` §6. They are quoted here verbatim so this RFC is self-contained for C1's reviewers; the canonical source remains the architecture RFC.

| Failure                                          | User-facing degradation                                                                                       | Operator runbook step                                                                                                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HD derivation failure (mnemonic missing/invalid) | Purchase flow falls back to fixed treasury; banner: "per-session addresses temporarily unavailable, your payment is still safe to send". | Read `/api/health`; verify `VIZZOR_TREASURY_MNEMONIC` is set; rotate via secrets manager if compromise suspected; redeploy; HD resumes on next process start.                                                                  |
| TON RPC throttled / 429                          | Watcher logs warnings; TON sessions stay pending past confirmation window; UI extends countdown.              | Switch `VIZZOR_TON_RPC_URL` to backup provider; restart site; replay pending sessions whose comment matches an on-chain tx via `scripts/payment-reconcile.ts` (added by C1 in a follow-up commit if needed).                   |
| Idempotency-key collision under cookie spoofing  | A user with a stolen cookie within the 60-second window receives the original requester's session row.        | This is a designed property: cookie-based dedupe collides only if cookies collide. SameSite=Strict + HttpOnly mitigate; CSRF on session create is C4 audit scope. Operator action: rotate `vizzor.session` salt (NEW env var). |
| Rate-cache total miss (all providers down + stale > 1h) | `POST /api/payment/session` returns `503 rate_unavailable`; UI shows "we cannot lock a quote right now". | Manually publish a one-shot quote via `scripts/payment-set-rate.ts` (future tooling); or wait for upstream restoration. SLO target: less than 5min per quarter.                                                                |
| Sweeper starvation (watchers disabled in prod)   | Pending rows accumulate; the GET-poll path keeps lazy-sweeping; no payment correctness impact.                | If both flags are intentionally off, ignore. If unintentional, restore the flags and the watcher resumes the sweep.                                                                                                            |

## 8. Schema deltas (additive only)

All schema deltas live in `lib/payment/db.ts:init()`, follow cycle-wide invariant #1 (no destructive changes), and are guarded by `CREATE TABLE IF NOT EXISTS` or `pragma table_info(...)` checks per the same pattern C2 uses for `subscriptions.telegram_user_id`.

```sql
-- New table: idempotency dedupe.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key          TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  FOREIGN KEY (session_id) REFERENCES payment_sessions(session_id)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_created
  ON idempotency_keys(created_at);

-- New table: persisted last-known-good rates.
CREATE TABLE IF NOT EXISTS rate_cache (
  token        TEXT PRIMARY KEY,
  usd_per      REAL NOT NULL,
  fetched_at   INTEGER NOT NULL,
  source       TEXT NOT NULL
);

-- payment_sessions gains derivation_index (nullable; populated when HD enabled).
-- Guarded ALTER inside init() using the hasColumn helper introduced by C2.
-- ALTER TABLE payment_sessions ADD COLUMN derivation_index INTEGER;
```

### Coordination with C2's migration helper

C2 introduces `hasColumn(db, table, column)` and `runV020Migrations(db)` per `wallet-telegram-binding.md` §3. C1 extends `runV020Migrations` with the additional guarded `ALTER`:

```ts
if (!hasColumn(db, 'payment_sessions', 'derivation_index')) {
  db.exec(`ALTER TABLE payment_sessions ADD COLUMN derivation_index INTEGER`);
}
```

If C2 lands first, C1 just adds the block. If C1 lands first (out-of-order merge), C1 introduces both `hasColumn` and the v0.2.0 migration wrapper, and C2 adds its blocks alongside. Either way, the final shape on `release/v0.2.0` is one migration helper called from `init()` carrying both branches' additions.

## 9. Test stubs (executed by C5)

C5 (`feature/v0.2.0/payment-qa`) owns Vitest setup. C1 ships `.test.ts` files written to that contract; they remain dormant until C5's setup lands. The stubs C1 ships:

- `tests/payment/hd.test.ts` — derivation determinism. A fixed mnemonic + index 0 yields a known Solana base58 address (golden vector) and a known TON friendly address. A re-derivation at index 0 yields the same address byte-for-byte. Derivation at index 1 yields a different address. Invalid mnemonic throws.
- `tests/payment/watcher-ton.test.ts` — match algorithm. Given a fake transaction with `comment=session_id` and `value` within slippage, the match returns the session. Given a wrong comment, no match. Given a comment match but amount outside slippage, no match (with a warn log).
- `tests/payment/idempotency.test.ts` — same-key dedupe. Two identical computed keys yield the same string. The lookup returns the recent session within the TTL window and `null` outside it.

The test bootstrap (`tests/setup.ts`, `vitest.config.ts`) is C5's deliverable. C1's test files use only `import { describe, expect, it } from 'vitest'` and standard Node fs APIs so they compile under any reasonable Vitest setup.

## 10. Env-var registry impact

Per architecture RFC §5, C1 owns the following entries; the `.env.example` entry is required before the route references the env var (cycle invariant #4).

| Env var                          | Default behavior                                | Owning code path                                                |
| -------------------------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| `VIZZOR_TREASURY_MNEMONIC`       | unset → fixed-treasury fallback                 | `lib/payment/hd.ts`, gated by `VIZZOR_HD_DERIVATION_ENABLED`    |
| `VIZZOR_HD_DERIVATION_ENABLED`   | `false`                                         | `lib/payment/session.ts:createSession` (route off HD vs fixed)  |
| `VIZZOR_TON_RPC_URL`             | `https://toncenter.com/api/v2/jsonRPC`          | `lib/payment/watcher-ton.ts`                                    |
| `VIZZOR_RATE_FALLBACK_PROVIDERS` | `'coingecko,coinmarketcap'`                     | `lib/payment/rates.ts:getRateWithFallback`                      |
| `VIZZOR_RATE_STALE_CEILING_MS`   | `3600000` (1 hour)                              | `lib/payment/rates.ts:getRateWithFallback`                      |
| `COINMARKETCAP_API_KEY`          | unset → secondary upstream skipped              | `lib/payment/rates.ts`                                          |

These additions to `.env.example` are part of the same commit that lands the code path that reads them.

## 11. Dependency additions

| Package           | Purpose                              | License | Tree-shake notes                                |
| ----------------- | ------------------------------------ | ------- | ----------------------------------------------- |
| `@scure/bip32`    | BIP-32 HD derivation                 | MIT     | Loaded only inside `hd.ts` (dynamic import).    |
| `@scure/bip39`    | BIP-39 mnemonic → seed               | MIT     | Loaded only inside `hd.ts` (dynamic import).    |
| `@ton/ton`        | TON RPC client + friendly-address    | MIT     | Loaded only inside `watcher-ton.ts` and `hd.ts`.|
| `@ton/crypto`     | TON address derivation primitives    | MIT     | Loaded only inside `hd.ts`.                     |

All dynamic imports are inside server-only modules; no browser-bundle impact.

## 12. Rollback

Rollback is a redeploy of the prior image tag plus the unchanged on-disk DB. The new tables and column are ignored by v0.1.0 code paths; the watcher and route fall back to v0.1.0 behavior (fixed treasury, no idempotency, single-upstream rate fetch). No data loss occurs from a rollback. The idempotency table grows during the rollback window with no consumer; the sweeper run after the next forward deploy clears it.

The HD flag `VIZZOR_HD_DERIVATION_ENABLED=false` provides a runtime kill-switch for the HD path without a redeploy. The fallback to the fixed treasury is on the hot path; flipping the flag has effect on the next session create with no process restart needed.

---

## Appendix A: Diff-impact (this branch only)

Per `wallet-telegram-binding.md` §10's matrix row for C1, this branch touches:

- `lib/payment/hd.ts` (NEW)
- `lib/payment/watcher-ton.ts` (NEW)
- `lib/payment/idempotency.ts` (NEW)
- `lib/payment/watcher.ts` (extend: read `wallet_links` after `finalizeSession` for TG back-fill — deferred until C2 lands)
- `lib/payment/rates.ts` (extend: `getRateWithFallback`, persisted-rate cache)
- `lib/payment/session.ts` (extend: idempotency lookup in `createSession`)
- `lib/payment/db.ts` (extend: `idempotency_keys`, `rate_cache`, `payment_sessions.derivation_index`)
- `lib/payment/treasury.ts` (extend: HD path with fixed-treasury fallback)
- `app/api/payment/session/route.ts` (extend: cookie-bound idempotency wiring)
- `tests/payment/hd.test.ts` (NEW — runs under C5's Vitest setup)
- `tests/payment/watcher-ton.test.ts` (NEW)
- `tests/payment/idempotency.test.ts` (NEW)
- `API_CONTRACT.md` (addendum: idempotency behavior)
- `.env.example` (NEW or extend if C6 created it: HD + RPC + rate fallback vars)
- `package.json`, `pnpm-lock.yaml` (deps)

## Appendix B: Forbidden attribution

Per `BRANCHING.md` §6 and `architecture.md` §4.9: no `Co-Authored-By`, no `Generated-By`, no AI-tool references, no emoji. Enforced repo-wide; restated here for downstream agents reading only this file.
