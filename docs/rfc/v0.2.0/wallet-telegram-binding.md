# RFC: Wallet ↔ Telegram User Binding — Design for Cross-Surface Subscription Parity

Status: Accepted for v0.2.0
Cycle: v0.2.0
Owner: site-vizzor architecture review
Companion: `docs/rfc/v0.2.0/architecture.md`

---

## 1. Problem statement

The user phrased the core question as: *"who pays and who gets access, and how do we link them?"*

After v0.1.0 shipped, the answers are:

- **Who pays.** The Solana wallet address that signed and broadcast the SPL transfer to the treasury. Resolved by `lib/payment/watcher.ts` extracting the payer address from the parsed transaction's pre/post token balances (`lib/payment/watcher.ts:172-211`) and writing it to `payment_sessions.payer_address`. The watcher then mints the canonical `subscriptions` row keyed by `wallet_address` (`lib/payment/watcher.ts:241-251`).
- **Who gets access on the site.** The wallet holding an active SIWS session. `/api/predict` resolves `auth_sessions.token → wallet_address` via `lib/payment/auth-session.ts:34-38`, then looks up `subscriptions.wallet_address` via `findActiveSubscriptionByWallet` (`lib/payment/db.ts:258-271`).
- **Who gets access on the Telegram bot.** Nobody. The bot today has zero integration with the site's `subscriptions` table. A user who pays on the site receives a grant code via the v0.1.0 grant scaffolding (`lib/payment/session.ts:217-229`, `lib/payment/db.ts:239-246`), but `redeemGrant(code, telegramUserId)` is a database helper with **no HTTP route exposing it** — there is no `app/api/grants/[code]/redeem/route.ts` in v0.1.0. Cross-surface subscription parity is therefore unshipped today: the site is self-sufficient, the bot is unaware, and the engine receives no signal beyond the per-wallet quota the site already enforces.

v0.2.0 closes this gap. This RFC is the design contract.

## 2. Identity model decision (Q1)

**Decision.** Adopt a hybrid identity model: anonymous purchase with grant handoff, plus pre-linked wallet. Both paths are first-class in v0.2.0.

### When the anonymous-with-handoff path is used

Default for any first-time purchaser, and the only path available to users who arrive at `/pay` without having interacted with the bot. The user pays without ever identifying as a Telegram account; on confirmation, the site issues a single-use grant code; the user clicks a `t.me/<bot>?start=g_<code>` deep-link; the bot redeems the code via the new `POST /api/grants/[code]/redeem` route; the site atomically writes the binding into `subscriptions.telegram_user_id` and (lazily) `wallet_links`.

### When the pre-linked-wallet path is used

Default for users who already use the bot and want to purchase from the site without the deep-link handshake. The user invokes `/link wallet` in the bot; the bot generates a SIWS-style challenge bound to the user's Telegram ID and presents a link; the user opens that link in their browser, signs with their wallet; the site verifies the signature, writes the binding into `wallet_links`, and from that moment any future on-chain payment by that wallet is automatically attributed to the linked Telegram user with no grant handshake required.

### Flow diagram — anonymous purchase with grant handoff

```
Browser           Site              Solana RPC      Watcher        Bot          Site (bot route)
  |                |                    |              |             |                  |
  |--POST session->|                    |              |             |                  |
  |<--session id---|                    |              |             |                  |
  |---transfer with memo=session_id---->|              |             |                  |
  |                |  (poll)            |              |             |                  |
  |                |<------------ tx confirmed --------|             |                  |
  |                |  finalizeSession() |              |             |                  |
  |                |  mint subscription |              |             |                  |
  |<--GET session/[id] returns confirmed + grantCode---|             |                  |
  |                |                    |              |             |                  |
  |---click t.me/<bot>?start=g_<code>------------------------->      |                  |
  |                |                    |              |             |--POST grant----->|
  |                |                    |              |             |  redeem          |
  |                |                    |              |             |<--{ok, sub}------|
  |                |                    |              |             |--reply to user-->|
```

### Flow diagram — pre-linked wallet

```
Bot          Site (link routes)      Browser        Wallet        Watcher
 |                |                     |              |             |
 |--/link wallet->|                     |              |             |
 |--POST link/challenge--------------->|               |             |
 |<--{ challenge_url, expires_at }------|               |             |
 |--reply with challenge_url to user--> |               |             |
 |                                       |---click url->|             |
 |                                       |<--SIWS msg---|             |
 |                                       |---sign------>|             |
 |                                       |<--signature--|             |
 |                                       |---POST wallet-links->     |
 |                                       |<--{ ok }------|             |
 |                                       |              |             |
 |        ... time passes; user pays from same wallet ...             |
 |                                       |---transfer--->             |
 |                                       |              |<--confirm---|
 |  finalizeSession() looks up wallet_links             |             |
 |  → subscription minted WITH telegram_user_id pre-populated         |
 |                                                                     |
 |  No grant code issued. Bot already has a subscription row visible   |
 |  via /api/subscriptions/lookup.                                     |
```

### Why hybrid

Anonymous-only would force every paid user through the deep-link handshake even when they explicitly want a persistent binding. Pre-linked-only would require users to use the bot first to ever pay on the site, breaking the v0.1.0 premise that the site is a self-sufficient purchase surface. The hybrid preserves the privacy posture of v0.1.0 (anonymous purchase remains supported) while opening a friction-light path for the user segment that uses both surfaces.

## 3. Schema changes (Q2)

All changes are additive. Migration runs on every site boot inside `init()` in `lib/payment/db.ts`. SQLite does not support `ADD COLUMN IF NOT EXISTS`; we use `pragma table_info(<table>)` to detect column presence and conditionally execute the `ALTER`.

### DDL

```sql
-- New table: pre-link records.
CREATE TABLE IF NOT EXISTS wallet_links (
  telegram_user_id  INTEGER NOT NULL,
  wallet_address    TEXT    NOT NULL,
  linked_at         INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  siws_token        TEXT,
  PRIMARY KEY (telegram_user_id, wallet_address)
);

-- Prevent fan-out: one TG user can link many wallets, one wallet links to one TG user.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_links_wallet
  ON wallet_links(wallet_address);

-- Pre-link challenge state (short-lived; pruned by sweeper).
CREATE TABLE IF NOT EXISTS wallet_link_challenges (
  challenge_id     TEXT PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL,
  nonce            TEXT NOT NULL,
  created_at       INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  expires_at       INTEGER NOT NULL,
  consumed_at      INTEGER
);

-- subscriptions gains telegram_user_id (nullable; populated at grant redeem OR pre-link inference at finalizeSession).
-- ALTER TABLE subscriptions ADD COLUMN telegram_user_id INTEGER;  -- guarded; see migration helper.

-- auth_sessions gains telegram_user_id (nullable; populated when the SIWS-authenticated wallet is in wallet_links).
-- ALTER TABLE auth_sessions ADD COLUMN telegram_user_id INTEGER;  -- guarded; see migration helper.
```

### Why a unique index on `wallet_address`

A wallet that has been linked to TG user A and then to TG user B is a re-attribution event. We refuse it at the DB layer: `INSERT OR IGNORE` from C2's `POST /api/wallet-links` will silently no-op on conflict; the bot is told `already_linked_elsewhere`. Re-linking requires an explicit `DELETE FROM wallet_links WHERE wallet_address = ?` operator action with audit trail. This is intentional: silently re-attributing a wallet hides subscription transfer attempts that may be social engineering.

### Migration helper sketch

The migration helper extends the `init()` function in `lib/payment/db.ts`. The full implementation lives on `feature/v0.2.0/wallet-telegram-binding`; this sketch is the contract.

```ts
function hasColumn(db: DB, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

function runV020Migrations(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_links (
      telegram_user_id  INTEGER NOT NULL,
      wallet_address    TEXT    NOT NULL,
      linked_at         INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      siws_token        TEXT,
      PRIMARY KEY (telegram_user_id, wallet_address)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_links_wallet
      ON wallet_links(wallet_address);
    CREATE TABLE IF NOT EXISTS wallet_link_challenges (
      challenge_id     TEXT PRIMARY KEY,
      telegram_user_id INTEGER NOT NULL,
      nonce            TEXT NOT NULL,
      created_at       INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      expires_at       INTEGER NOT NULL,
      consumed_at      INTEGER
    );
  `);
  if (!hasColumn(db, 'subscriptions', 'telegram_user_id')) {
    db.exec(`ALTER TABLE subscriptions ADD COLUMN telegram_user_id INTEGER`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_subs_tg ON subscriptions(telegram_user_id)`);
  }
  if (!hasColumn(db, 'auth_sessions', 'telegram_user_id')) {
    db.exec(`ALTER TABLE auth_sessions ADD COLUMN telegram_user_id INTEGER`);
  }
}
```

`runV020Migrations` is called immediately after the existing `db.exec(...)` block in `init()`. The function is idempotent: re-runs are no-ops because of `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and the `hasColumn` guard.

### Rollback

The migration is additive, so a rollback is a redeploy of the prior image tag plus the unchanged on-disk DB. The new columns and tables are ignored by v0.1.0 code paths; SQLite tolerates extra columns on read and extra tables in the schema. No data loss occurs from a rollback unless the operator also restores from a snapshot taken before the migration ran, which is not required.

## 4. Cross-surface authorization (Q3)

**Decision for v0.2.0: Option (a) — Site as the source of truth.** The bot calls the site over HTTP for every subscription resolution. The engine is never told who is paid; the bot decides per-request whether to forward `/predict` to the engine based on the site's response.

### `GET /api/subscriptions/lookup?telegram_user_id={id}` contract

| Field             | Value                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| Method            | `GET`                                                                                             |
| Path              | `/api/subscriptions/lookup`                                                                       |
| Query             | `telegram_user_id` (integer, required); `wallet_address` (string, optional — used when bot already has it from `wallet_links`) |
| Auth header       | `x-vizzor-bot-token: <VIZZOR_BOT_SHARED_SECRET>`                                                  |
| Caching policy    | None server-side. Response carries `Cache-Control: no-store`. The bot is expected to cache locally if it wants to; the site does not assist with cache headers because subscription expiry timing matters within seconds of the grant edge. |
| Latency budget    | p99 < 100ms target. Backed by an index on `subscriptions(telegram_user_id)` plus SQLite's in-process semantics. Measured by C5 and monitored by C6.                  |
| Success response  | `200 { ok: true, subscription: { tier, cadence, expires_at, wallet_address } | null }` — `null` when the user has no active subscription                              |
| Failure responses | `400 { ok: false, reason: 'invalid_input' }` (malformed query); `401 { ok: false, reason: 'unauthorized' }` (missing or wrong shared secret); `5xx` reserved for infra failures |

### Why no caching

The bot polls this route on every `/predict` invocation. A cache reduces site load but introduces a window where a freshly-redeemed grant is invisible to the bot. The v0.2.0 acceptance bar is: a user who completes the deep-link handshake on a Saturday evening receives a successful `/predict` reply on their next bot message. A 30-second cache would break that. The site is fast enough to serve uncached reads at the volume the bot will produce in v0.2.0.

The env var `VIZZOR_BIND_LOOKUP_CACHE_TTL_MS` exists to allow an operator to opt-in to caching during incident response; default is `0` (off).

### Migration ramp to Option (c) Postgres for v0.3.0 (informational, not committed)

When site read volume from the bot exceeds the SQLite single-writer regime — empirically around 200 reads/sec sustained or when the bot tail latency exceeds the 100ms p99 target under steady-state — v0.3.0 will migrate both site and engine to a shared Postgres `subscriptions` table. The schema in this RFC is shaped to translate directly (`INTEGER`, `TEXT` columns map cleanly; the indexes carry over). Until that migration ships, Option (a) is the canonical path. Option (b) — site mirrors to engine — is rejected for v0.2.0 because two sources of truth create a sync-drift class of bug that is harder to debug than added latency.

## 5. Grant redemption contract (Q4)

### `POST /api/grants/[code]/redeem` contract

| Field             | Value                                                                                                                                                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method            | `POST`                                                                                                                                                                                                                                                                                               |
| Path              | `/api/grants/[code]/redeem`                                                                                                                                                                                                                                                                          |
| Auth header       | `x-vizzor-bot-token: <VIZZOR_BOT_SHARED_SECRET>`                                                                                                                                                                                                                                                     |
| Request body      | `{ telegram_user_id: number, telegram_username?: string }`                                                                                                                                                                                                                                            |
| Success response  | `200 { ok: true, subscription: { tier, cadence, expires_at, wallet_address } }`                                                                                                                                                                                                                       |
| Failure responses | `400 { ok: false, reason: 'invalid_code' }` (`code` not in `grants`); `409 { ok: false, reason: 'already_redeemed' }` (redeemed by a different `telegram_user_id`); `410 { ok: false, reason: 'expired' }` (now > `grants.expires_at`); `412 { ok: false, reason: 'session_not_confirmed' }` (the underlying `payment_sessions.status` is not `confirmed`); `401 { ok: false, reason: 'unauthorized' }` (wrong or missing shared secret) |
| Idempotency rule  | Retry-safe by the `(code, telegram_user_id)` pair. If `grants.redeemed_by = telegram_user_id` already, the route returns `200 { ok: true, subscription }` with the same `subscriptions` row it returned on the first redemption.                                                                       |
| Transaction       | Atomic. In one SQLite transaction: `UPDATE grants SET redeemed_by, redeemed_at WHERE code = ? AND redeemed_by IS NULL`; `UPDATE subscriptions SET telegram_user_id = ? WHERE session_id = ? AND telegram_user_id IS NULL`; `INSERT OR IGNORE INTO wallet_links (telegram_user_id, wallet_address) VALUES (?, ?)`. If any step fails, the transaction rolls back and a `5xx` is returned. |

### Example successful curl from the bot side

```
curl -X POST 'https://vizzor.ai/api/grants/g_kY7hP8aQ2zX9LmRb/redeem' \
  -H 'content-type: application/json' \
  -H 'x-vizzor-bot-token: REDACTED' \
  -d '{"telegram_user_id": 12345, "telegram_username": "satoshi"}'

HTTP/1.1 200 OK
content-type: application/json
cache-control: no-store

{"ok":true,"subscription":{"tier":"pro","cadence":"monthly","expires_at":1748736000000,"wallet_address":"5xK..."}}
```

### Side effects on success

1. `grants.redeemed_by` becomes `telegram_user_id`; `grants.redeemed_at` becomes `Date.now()`.
2. `subscriptions.telegram_user_id` is set on the row whose `session_id` matches the grant. The row's `wallet_address` is preserved; no new subscription is created.
3. `wallet_links` gains a row binding `(telegram_user_id, wallet_address)` unless one already exists (in which case `INSERT OR IGNORE` silently skips).

`telegram_username` is accepted but not persisted in v0.2.0 — usernames are mutable and not a reliable identifier. We store only `telegram_user_id`. C2 may add a `telegram_username_last_seen` column in a future RFC if support tooling needs it; not in this cycle.

## 6. Pre-link contract

The pre-link flow has two HTTP touch-points on the site: a challenge endpoint the bot calls to mint a signed-link URL, and a verification endpoint the browser calls after the user signs.

### `POST /api/wallet-links/challenge`

| Field             | Value                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Method            | `POST`                                                                                         |
| Path              | `/api/wallet-links/challenge`                                                                  |
| Auth header       | `x-vizzor-bot-token: <VIZZOR_BOT_SHARED_SECRET>`                                               |
| Request body      | `{ telegram_user_id: number }`                                                                 |
| Success response  | `200 { ok: true, challenge_id: string, challenge_url: string, expires_at: number }`             |
| Failure responses | `400 invalid_input`, `401 unauthorized`                                                        |
| Side effects      | Inserts a row in `wallet_link_challenges` with a 5-minute TTL. `challenge_url` is `https://vizzor.ai/link?c=<challenge_id>` and is what the bot DMs to the user. |

### Browser flow at `/link?c=<challenge_id>`

The page reads `challenge_id` from the query, calls the existing SIWS nonce route adapted with a `purpose=link` parameter so the canonical message reads "Sign in to vizzor.ai to link wallet to Telegram user <obfuscated id>" instead of the login phrase, prompts the wallet to sign, and POSTs to `POST /api/wallet-links`.

### `POST /api/wallet-links` (browser-facing)

| Field             | Value                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method            | `POST`                                                                                                                                                                                      |
| Path              | `/api/wallet-links`                                                                                                                                                                         |
| Auth              | None at the HTTP layer — the SIWS signature IS the auth. CSRF: `same-site=strict` cookie binding plus origin check.                                                                          |
| Request body      | `{ challenge_id: string, wallet: string, signature: string, message: string }`                                                                                                              |
| Success response  | `200 { ok: true }`                                                                                                                                                                          |
| Failure responses | `400 invalid_input`, `401 invalid_signature`, `409 already_linked_elsewhere`, `410 challenge_expired`                                                                                       |
| Side effects      | Marks `wallet_link_challenges.consumed_at`; `INSERT INTO wallet_links` with the `siws_token` captured for forensic trail. If the `UNIQUE INDEX` on `wallet_address` fires, returns `already_linked_elsewhere`. |

### Why two routes for pre-link

The challenge route is bot-authenticated; the verification route is signature-authenticated. Combining them would either expose the bot's shared secret to the browser (forbidden) or weaken the signature binding (the bot would be signing for a TG user it claims). Two routes also let us emit the challenge URL via Telegram (which obscures the URL behind a link preview) without needing to deliver bot secrets across the bot/browser boundary.

The SIWS message for the link path is built by extending `lib/payment/siws.ts` with a `buildSiwsLinkMessage` variant that swaps the action line. The signature scheme is unchanged (ed25519 over the canonical message bytes), so the verification helper `verifySiwsSignature` is reused as-is.

## 7. Bot ↔ site shared-secret lifecycle

### Generation

32 random bytes encoded base64url, generated by the operator on a trusted workstation:

```
node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))'
```

### Distribution

For v0.2.0, the secret is distributed manually. The operator sets `VIZZOR_BOT_SHARED_SECRET` on the site host via the existing env-var injection mechanism (Docker compose env file) and the same value on the bot host via the bot's deployment mechanism. C6 owns the migration to a managed secret store; until that ships, the manual flow is the contract.

### Rotation procedure

1. Generate the new secret on a trusted workstation.
2. Deploy the new secret to the site as `VIZZOR_BOT_SHARED_SECRET_NEXT` alongside the current `VIZZOR_BOT_SHARED_SECRET`. The site code accepts either value during the rotation window (logic implemented as an `OR` check in the auth middleware).
3. Deploy the new secret to the bot as `VIZZOR_BOT_SHARED_SECRET`, replacing the old value. The bot uses the new secret from this point.
4. Verify a probe call from the bot succeeds against the site.
5. Remove `VIZZOR_BOT_SHARED_SECRET` from the site (the old value), promote `VIZZOR_BOT_SHARED_SECRET_NEXT` to the canonical name, and re-deploy.

### What breaks during rotation

Steps 2 through 5 are zero-downtime. The only failure mode is between steps 3 and 4 if the bot deploy lands before the site deploy: the bot uses the new secret, the site only knows the old secret, every redeem and lookup returns 401, and `/predict` falls back to the engine's free-tier quota for paid users. Mitigation: always deploy site first (step 2) and verify with a probe before deploying the bot (step 3).

### Fail-closed semantics

Every route that requires the shared secret returns `401 { ok: false, reason: 'unauthorized' }` when the header is absent, empty, or does not match either accepted secret. The site never logs the received header value (logs the boolean `accepted` flag only). On unset `VIZZOR_BOT_SHARED_SECRET` in production, the routes return `503` and the site's `/api/health` payload exposes `bot_auth_configured: false` so monitoring catches it within the health-check window.

## 8. Privacy and threat model summary

### What data leaves the browser

- The on-chain payment, which is public by virtue of being on a public blockchain. v0.2.0 adds no additional on-chain footprint.
- The grant code, which is an opaque random UUID with a 24-hour TTL and no information about the user or the purchase beyond the link to a confirmed `payment_sessions` row.
- The SIWS signature, scoped to either `login` (default v0.1.0 message) or `link` (new v0.2.0 message). The signature reveals only the wallet public key, which the user already self-declares by transferring tokens.

### What the bot tells the site

- `telegram_user_id` at redemption and at lookup. This is the integer ID Telegram assigns at account creation; sharing it with the site is intrinsic to the binding goal and the user opts in by clicking the deep-link.
- `telegram_username` optionally at redemption. Not persisted in v0.2.0.

### What the engine is told

- Nothing about payments, wallets, grants, or Telegram IDs. The engine receives `/predict` requests and serves them. The bot decides whether to forward a request based on the site's lookup response. The engine sees a request and either accepts it (paid path) or rejects with free-tier quota (free path). The decision boundary is the bot, not the engine.

### What is explicitly deferred to C4

- The full SIWS replay-protection audit, including multi-tab semantics, nonce-cookie binding strength, and the move of the in-memory replay cache to durable SQLite storage.
- The signature-scope tightening between login and link (this RFC commits to two scopes; C4 verifies the implementation enforces them).
- The treasury custody review covering the HD mnemonic added in C1.
- The CVE sweep across the wallet adapter, Solana, TON, and signature libraries.

This RFC does NOT claim a complete security audit. It defines the contract; C4 audits it.

## 9. Migration timeline

### v0.2.0 (this cycle)

Ships everything above: hybrid identity model, additive schema migrations, `GET /api/subscriptions/lookup`, `POST /api/grants/[code]/redeem`, `POST /api/wallet-links/challenge`, `POST /api/wallet-links`, the SIWS link variant, and the bot-shared-secret lifecycle and rotation procedure. The engine remains untouched; cross-surface parity flows through the site exclusively. Postgres migration is NOT in scope.

### v0.3.0

Ships the shared Postgres `subscriptions` table read by both site and engine, retiring the bot ↔ site lookup round-trip on the engine path. The bot continues to call the site for grant redemption (because grants are a site-owned concept), but the engine reads subscription state directly. The site's SQLite schema becomes a write-through cache that fills the same Postgres rows on confirmed payment; the engine reads only Postgres. This is the documented next step for when bot read volume forces the migration. The shape of the migration is `pg_dump`-style: the column types in §3 translate directly.

### v0.4.0

Ships auto-renewal, refunds, and a subscription portal UI. Auto-renewal requires either a recurring on-chain payment primitive (none exists today on Solana or TON in production-ready form) or a wallet-held authorization the site can act on (Solana programs exist but require additional security review and were rejected from v0.2.0 scope explicitly). Refunds require an operator-initiated reverse transfer with an audited approval flow. Subscription portal is the user-facing surface that exposes subscription state, history, and link/unlink controls. All three are out of scope for v0.2.0 and v0.3.0 and are recorded here only so the v0.2.0 schema and routes are forward-compatible.

## 10. Diff-impact matrix

Per sub-branch, the files this RFC tells you to touch. The "nature of change" column distinguishes additive new files, extensions of an existing module's surface, and pure extensions of behavior that do not change the public type signature.

| Sub-branch                                     | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Nature of change                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `feature/v0.2.0/wallet-telegram-binding` (C2)  | `lib/payment/db.ts` (extend `init()` with `runV020Migrations`, add helpers `insertWalletLink`, `findWalletLinkByWallet`, `findWalletLinkByTelegram`, `setSubscriptionTelegramUserId`, `findSubscriptionByTelegram`, `insertWalletLinkChallenge`, `getWalletLinkChallenge`, `markWalletLinkChallengeConsumed`); `lib/payment/siws.ts` (add `buildSiwsLinkMessage`); `lib/payment/auth-session.ts` (extend `ActiveSession` with optional `telegramUserId`); `lib/payment/binding.ts` (NEW — orchestration for redeem and pre-link); `app/api/grants/[code]/redeem/route.ts` (NEW); `app/api/subscriptions/lookup/route.ts` (NEW); `app/api/wallet-links/route.ts` (NEW); `app/api/wallet-links/challenge/route.ts` (NEW); `app/api/auth/siws/nonce/route.ts` (extend to accept `purpose=link`); `app/api/auth/siws/verify/route.ts` (extend to refuse a `purpose=link` message at the login route); `API_CONTRACT.md` (addendum with the bot ↔ site contract from §5 and §6); `.env.example` (add `VIZZOR_BOT_SHARED_SECRET`, `VIZZOR_BIND_LOOKUP_CACHE_TTL_MS`) | additive (new files); extension (existing modules); contract documentation                                          |
| `feature/v0.2.0/web3-purchase-flow` (C1)       | `lib/payment/treasury.ts` (rewrite to support HD derivation per session); `lib/payment/hd.ts` (NEW); `lib/payment/watcher-ton.ts` (NEW, mirrors `watcher.ts` structure); `lib/payment/watcher.ts` (read `wallet_links` after `finalizeSession` to back-fill `subscriptions.telegram_user_id` when a pre-link exists; this is the load-bearing seam where C1 consumes C2's table); `lib/payment/session.ts` (idempotency on `createSession`); `lib/payment/rates.ts` (fallback chain); `app/api/payment/session/route.ts` (idempotency wiring); `.env.example` (HD + RPC + rate fallback vars) | extension (existing modules); additive (new files); consumes C2's `wallet_links` read path                          |
| `feature/v0.2.0/purchase-ux` (C3)              | `components/pay/checkout-shell.tsx`, `components/pay/grant-handoff.tsx`, `components/pay/payment-status.tsx` (state machine + failure copy); `components/pay/pre-link-affordance.tsx` (NEW); `messages/{en,es,fr}.json` `pay.*` (failure-reason strings, pre-link strings); read-only consumer of `GET /api/auth/session` extended payload (`telegramUserId` if set)                                                                                                                                                                                                                          | extension (existing components); additive (new component); i18n parity                                              |
| `feature/v0.2.0/crypto-security` (C4)          | `lib/payment/siws.ts` (replay-protection audit, scope tightening enforcement around `purpose=link` vs `purpose=login`); `lib/payment/replay-cache.ts` (NEW — durable SQLite replay cache replacing the in-memory LRU); `lib/solana.ts` (ATA-validation audit and patch); `API_CONTRACT.md` (authz annex covering the three new routes); dependency CVE sweep producing a `docs/rfc/v0.2.0/crypto-security.md` checklist                                                                                                                                                                       | extension (existing modules); additive (new module); audit deliverable                                              |
| `feature/v0.2.0/payment-qa` (C5)               | `tests/setup.ts` (NEW), `tests/payment/db.test.ts`, `tests/payment/siws.test.ts`, `tests/payment/watcher.test.ts`, `tests/payment/pricing-table.test.ts`, `tests/payment/binding.test.ts`, `tests/payment/grant-redeem.test.ts`, `tests/payment/subscription-lookup.test.ts`, `tests/payment/wallet-links.test.ts`, `tests/payment/siws-link.test.ts`, `tests/auth/siws.test.ts`, `tests/api/predict.test.ts`; `vitest.config.ts` (NEW); `.github/workflows/ci.yml` (remove `continue-on-error: true` on the test job in the final commit of the branch)                                                                                                                                       | additive (test surfaces); CI patch                                                                                  |
| `feature/v0.2.0/infra-hardening` (C6)          | `Dockerfile` (if env-var posture changes need image-level support); `docker-compose.prod.yml` (in the adjacent vizzor product repo — documented snippet only); `.env.example` (Sentry DSN, dedicated RPC vars); operator runbook at `docs/rfc/v0.2.0/infra-hardening.md`; secrets-management migration plan                                                                                                                                                                                                                                                                                  | extension (build + deploy); documentation deliverable                                                               |

---

## Appendix A: Forbidden attribution policy

Per `BRANCHING.md` Section 6, commit messages, pull-request bodies, changelog entries, and RFC content must not contain `Co-Authored-By`, `Generated-By`, references to Claude, ChatGPT, Copilot, Cursor, or other AI tooling, or emoji. This appendix exists as a normative reminder for downstream agents implementing this RFC.

## Appendix B: References

- `lib/payment/db.ts:239-246` — current `redeemGrant(code, telegramUserId)` helper with no HTTP caller; the v0.1.0 gap this RFC closes.
- `lib/payment/session.ts:217-229` — current `issueGrantForSession`; emits the grant code that this RFC's `POST /api/grants/[code]/redeem` consumes.
- `lib/payment/watcher.ts:241-251` — current `finalizeSession`; extended by C1 to consume `wallet_links` for back-fill.
- `lib/payment/siws.ts:47-66` — current `buildSiwsMessage`; extended by C2 with `buildSiwsLinkMessage`.
- `lib/payment/auth-session.ts:21-32` — current `getActiveSession`; extended by C2 to surface `telegramUserId` when the active wallet appears in `wallet_links`.
- `docs/rfc/v0.2.0/architecture.md` — the cross-cutting cycle RFC. This binding RFC is one of its load-bearing inputs.
