# RFC: v0.2.0 Cross-Cutting Architecture

Status: Accepted
Cycle: v0.2.0
Owner: site-vizzor architecture review
Companion: `docs/rfc/v0.2.0/wallet-telegram-binding.md`

---

## 1. Cycle context

The v0.2.0 cycle hardens the Web3 purchase subsystem that shipped in v0.1.0 and closes the wallet-to-Telegram binding gap. v0.1.0 delivered site-owned payment sessions, a Solana watcher, SIWS browser auth, and the `subscriptions` data model — but every paying wallet today is invisible to the Telegram bot, the engine has no idea who is paid, and several v0.1.0 modules carry deferred TODOs (HD address derivation in `lib/payment/treasury.ts`, TON watcher parity, durable replay caches). v0.2.0 ships those primitives end-to-end and exposes the missing HTTP surface that lets the bot redeem grants, look up subscriptions, and pre-link wallets to Telegram users. Six sub-branches own one engineering discipline each; this RFC is the contract that keeps them from colliding on shared schema, env vars, and routes.

## 2. Cross-branch contract map

The following surfaces are touched by more than one sub-branch. Each row is a merge-conflict candidate and must be reviewed when the sub-branches consolidate into `release/v0.2.0`.

| Shared surface                                    | C1 web3-purchase-flow | C2 wallet-telegram-binding | C3 purchase-ux | C4 crypto-security | C5 payment-qa | C6 infra-hardening | Conflict risk |
| ------------------------------------------------- | --------------------- | -------------------------- | -------------- | ------------------ | ------------- | ------------------ | ------------- |
| `lib/payment/db.ts` (schema init + helpers)       | write (HD fields)     | write (binding tables)     | read           | write (replay cache table) | read     | -                  | High          |
| `lib/payment/siws.ts`                             | -                     | extend (bot-scoped variant)| read           | audit + patch      | test          | -                  | Medium        |
| `lib/payment/watcher.ts`                          | extend (TON sibling)  | -                          | -              | audit              | test          | read (RPC env)     | Low           |
| `lib/payment/treasury.ts`                         | rewrite (HD derive)   | -                          | -              | audit (key custody)| test          | read (env)         | Medium        |
| `lib/payment/rates.ts`                            | extend (fallback)     | -                          | -              | -                  | test          | -                  | Low           |
| `lib/payment/auth-session.ts`                     | -                     | extend (TG-id surface)     | read           | audit              | test          | -                  | Low           |
| `lib/payment/session.ts`                          | extend (idempotency)  | -                          | read           | -                  | test          | -                  | Low           |
| (new) `lib/payment/binding.ts`                    | -                     | new file                   | read           | -                  | test          | -                  | None          |
| (new) `lib/payment/hd.ts`                         | new file              | -                          | -              | audit              | test          | -                  | None          |
| (new) `lib/payment/watcher-ton.ts`                | new file              | -                          | -              | audit              | test          | read (RPC env)     | None          |
| `app/api/payment/session/route.ts`                | write (idempotency)   | -                          | read           | -                  | test          | -                  | Low           |
| `app/api/payment/session/[id]/route.ts`           | write (sweeper)       | -                          | read           | -                  | test          | -                  | Low           |
| `app/api/auth/siws/{nonce,verify}/route.ts`       | -                     | -                          | read           | audit + patch      | test          | -                  | Low           |
| (new) `app/api/grants/[code]/redeem/route.ts`     | -                     | new file                   | -              | audit (auth header)| test          | -                  | None          |
| (new) `app/api/subscriptions/lookup/route.ts`     | -                     | new file                   | -              | audit (auth header)| test          | -                  | None          |
| (new) `app/api/wallet-links/route.ts`             | -                     | new file                   | -              | audit              | test          | -                  | None          |
| (new) `app/api/wallet-links/challenge/route.ts`   | -                     | new file                   | -              | audit              | test          | -                  | None          |
| `components/pay/*`                                | -                     | -                          | write          | -                  | -             | -                  | None          |
| `messages/{en,es,fr}.json` `pay.*` namespace      | -                     | -                          | write          | -                  | -             | -                  | None          |
| `API_CONTRACT.md`                                 | -                     | write (binding addendum)   | -              | write (auth annex) | -             | -                  | Medium        |
| `.github/workflows/ci.yml`                        | -                     | -                          | -              | -                  | write (drop `continue-on-error`) | write (smoke test) | Low |
| `Dockerfile`                                      | -                     | -                          | -              | -                  | -             | write              | None          |
| `package.json` (`dependencies`)                   | write (TON SDK)       | -                          | write (QR lib) | write (CVE bumps)  | write (vitest)| write (Sentry SDK) | High (lockfile) |
| `pnpm-lock.yaml`                                  | write                 | write                      | write          | write              | write         | write              | Critical (lockfile churn) |
| `.env.example`                                    | write                 | write                      | -              | write              | -             | write              | High          |

**Lockfile policy.** Every sub-branch will touch `pnpm-lock.yaml`. To minimize three-way merge pain we adopt the convention: each sub-branch keeps its commit set linear (no merges from `release/v0.2.0`), and the integrator rebuilds the lockfile after each merge into `release/v0.2.0` by running `pnpm install` in a single commit scoped `chore(deps): rebuild lockfile after merge of <sub-branch>`. The integrator pushes that commit directly to `release/v0.2.0`. This is the only exception to the "all commits land via PR" rule and is permitted because lockfile reconciliation is mechanical.

## 3. Merge order recommendation

The order below minimizes rework on `release/v0.2.0` HEAD as each sub-branch lands. The reasoning is in the right-hand column.

| Order | Sub-branch                                | Why this slot                                                                                                                                                                                                                                                                          |
| ----- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `feature/v0.2.0/payment-qa`               | Vitest + tests harness lands first so every subsequent branch can ship and validate its own tests against the same setup. The CI `continue-on-error` flag is dropped at the END of payment-qa's work (final commit), not at the start, so other branches are not blocked by a red baseline.|
| 2     | `feature/v0.2.0/wallet-telegram-binding`  | Owns the schema additions (`wallet_links`, `subscriptions.telegram_user_id`, `auth_sessions.telegram_user_id`) plus three new routes. Lands before purchase-ux because C3's pre-link affordance reads the binding contract. Lands before crypto-security because C4's audit covers the new routes. |
| 3     | `feature/v0.2.0/web3-purchase-flow`       | HD derivation, TON watcher, idempotency, rate-cache fallback. Independent of C2's schema (touches different rows of `payment_sessions`, not `subscriptions`). Lands before crypto-security because C4 audits the HD key custody story.                                                |
| 4     | `feature/v0.2.0/crypto-security`          | Threat model + audits + replay-cache durability. Lands after C1 and C2 so the audit covers their actual surface, not a moving target.                                                                                                                                                |
| 5     | `feature/v0.2.0/purchase-ux`              | Wallet-connect state machine, full failure-mode i18n, grant-handoff card, pre-link affordance. Lands late because it consumes the API contracts from C1, C2 and the error taxonomy from C4. UI churn is cheap to rebase; backend churn is not.                                       |
| 6     | `feature/v0.2.0/infra-hardening`          | Persistent DB volume, secrets manager, dedicated RPC, Sentry wiring. Lands last because it adds env-var requirements that depend on the final set of secrets each preceding branch settled on (bot shared secret in C2, treasury mnemonic in C1+C4, Sentry DSN scope across all routes).|

Any sub-branch may PR earlier than its slot if conflict-free; the order above is the merge order, not the open-PR order.

## 4. Cycle-wide invariants

Every sub-branch must respect the following rules. Violations are blocking review feedback.

1. **No destructive schema changes.** Migrations are additive only. `CREATE TABLE IF NOT EXISTS` for new tables; `ALTER TABLE ADD COLUMN` for new columns, guarded by `PRAGMA table_info(<table>)` checks since SQLite does not support `ADD COLUMN IF NOT EXISTS`. No `DROP COLUMN`, no `DROP TABLE`, no destructive `UPDATE` against existing rows during init. Rollback is the prior image tag plus an unchanged on-disk DB.
2. **Engine remains canonical for price validation.** v0.2.0 does NOT introduce any code path where the site computes the engine's USD price for `/predict`. Pricing for purchase flows is owned by `lib/payment/pricing-table.ts`. Pricing for prediction quota is owned by the engine. The site never advertises an engine price.
3. **Every new API route ships with a Vitest test in the `payment-qa` branch.** A new route under `app/api/**` without a corresponding `tests/**` file blocks the PR. The test must cover the happy path and at least one failure-mode response.
4. **No new env var without an `.env.example` entry.** The `.env.example` file is the source of truth for the env-var registry (Section 5). Adding a `process.env.XYZ` reference without a matching `.env.example` line blocks the PR.
5. **No public-internet defaults in production code paths.** Defaults like `'https://api.mainnet-beta.solana.com'` are permitted only when guarded by a development-only check or paired with a startup warning. C6 owns the migration; the cycle-wide rule is that v0.2.0 ships fail-closed for missing critical secrets in production.
6. **No leakage of bot internals to the browser bundle.** `VIZZOR_BOT_SHARED_SECRET` is server-only. Any module that references it must not be imported by a `'use client'` module. C2 owns the routes that touch it; the rule is universal.
7. **i18n parity for user-facing copy.** Any new `pay.*` message added in `messages/en.json` must land in `messages/es.json` and `messages/fr.json` in the same PR. Empty strings are not parity; either translate or revert. C3 owns the bulk of these; the rule applies to every branch that adds user-facing strings.
8. **Watcher determinism.** The on-chain watchers (Solana, TON) must remain idempotent under restart: confirming the same `(session_id, tx_sig)` pair twice produces zero side effects. C1's idempotency work for `POST /api/payment/session` extends this guarantee end-to-end.
9. **Forbidden attribution.** No `Co-Authored-By`, no `Generated-By`, no AI-tool references, no emoji. Enforced repo-wide by `BRANCHING.md` Section 6; restated here so RFC readers see it inline.

## 5. Shared env-var registry

Every v0.2.0 env var, its scope, defaulting behavior, and owning sub-branch. The `.env.example` file in `release/v0.2.0` HEAD must match this table at cycle exit.

| Env var                              | Scope          | Default behavior in non-prod          | Production behavior            | Owning sub-branch            |
| ------------------------------------ | -------------- | ------------------------------------- | ------------------------------ | ---------------------------- |
| `VIZZOR_BOT_SHARED_SECRET`           | server         | unset → bot routes fail-closed 401    | required; absence fails health | C2 wallet-telegram-binding   |
| `VIZZOR_TREASURY_MNEMONIC`           | server         | unset → fall back to fixed treasury env | required when HD enabled; absence fails health when HD flag is on | C1 web3-purchase-flow      |
| `VIZZOR_HD_DERIVATION_ENABLED`       | server         | `false`                               | `true` once C4 audit clears    | C1 web3-purchase-flow        |
| `VIZZOR_TON_RPC_URL`                 | server         | toncenter public endpoint             | dedicated provider URL         | C1 web3-purchase-flow        |
| `VIZZOR_SOLANA_RPC_URL`              | server         | `https://api.mainnet-beta.solana.com` | dedicated provider URL; absence fails health | C6 infra-hardening |
| `VIZZOR_REPLAY_CACHE_DB`             | server         | inherits `VIZZOR_SITE_DB`             | same                           | C4 crypto-security           |
| `VIZZOR_REPLAY_CACHE_SIZE`           | server         | `4096`                                | tuned by ops                   | C4 crypto-security           |
| `VIZZOR_SENTRY_DSN`                  | server         | unset → no-op                         | required; absence emits warning, does not fail health | C6 infra-hardening |
| `VIZZOR_RATE_FALLBACK_PROVIDERS`     | server         | `'coingecko,coinmarketcap'`           | same; ops can reorder          | C1 web3-purchase-flow        |
| `VIZZOR_BIND_LOOKUP_CACHE_TTL_MS`    | server         | `0` (no cache)                        | `0` (no cache, per RFC #2 §4)  | C2 wallet-telegram-binding   |
| `NEXT_PUBLIC_TG_BOT_USERNAME`        | client         | `'vizzorai_bot'`                      | same                           | C3 purchase-ux               |

Notes:
- `VIZZOR_SITE_DB`, `VIZZOR_TON_TREASURY`, `VIZZOR_SOLANA_TREASURY`, `NEXT_PUBLIC_VIZZOR_MINT`, `SOLANA_RPC_URL`, `NEXT_PUBLIC_SOLANA_RPC_URL` are v0.1.0 vars. C6 is responsible for documenting their production behavior in the deployment runbook; this RFC does not redefine them.
- The `NEXT_PUBLIC_*` prefix on `NEXT_PUBLIC_TG_BOT_USERNAME` is intentional: it is read by client-side code that builds the `t.me/<bot>?start=g_<code>` deep-link.

## 6. Failure-mode catalog

Each row is a new failure surface introduced or surfaced by v0.2.0. Operators must have a runbook entry for each; users must see a coherent degradation.

| Failure                                          | User-facing degradation                                                                 | Operator runbook step                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HD derivation failure (mnemonic missing/invalid) | Purchase flow falls back to fixed treasury address; banner: "per-session addresses temporarily unavailable, your payment is still safe to send". | Read `/api/health` payload; verify `VIZZOR_TREASURY_MNEMONIC` is set; rotate via secrets manager if compromise suspected; re-deploy; HD resumes on next process start. |
| Bot shared secret missing / mismatched           | Bot calls to `/api/grants/[code]/redeem`, `/api/subscriptions/lookup`, `/api/wallet-links` all return 401. Bot-side: `/start g_<code>` shows "we could not verify your grant — try again in a few minutes". Site-side: no degradation (browser flow unaffected). | Confirm `VIZZOR_BOT_SHARED_SECRET` is set on both site and bot; rotate per RFC #2 §7; restart bot to pick up new value; site does not need restart (env is read per-request). |
| Solana RPC throttled / 429                       | Watcher logs warnings, sessions stay `pending` past expiry, UI shows "we are confirming your payment — this can take up to N minutes" with extended countdown.       | Switch `VIZZOR_SOLANA_RPC_URL` to backup provider; restart site; manually replay `pending` sessions whose `tx_sig` is set on-chain via the operator script `scripts/payment-reconcile.ts` (added by C1).                |
| TON RPC throttled / 429                          | Same as Solana but scoped to TON-paying users.                                          | Same as Solana but `VIZZOR_TON_RPC_URL`.                                                                                                                |
| Persistent replay-cache full                     | Watcher slows but does not stop; oldest entries evicted per LRU. No user-facing degradation. | Increase `VIZZOR_REPLAY_CACHE_SIZE`; restart; monitor RSS. If sustained growth indicates a hot mint with many tx, escalate to C4 for cap tuning.       |
| `wallet_links` table corruption                  | Pre-linked users see "wallet not linked" in bot; grant-handoff path still works.        | Restore site DB from latest snapshot; the `wallet_links` table is recoverable from the union of confirmed `subscriptions` rows with non-null `telegram_user_id` plus user re-link prompts; runbook in `docs/rfc/v0.2.0/wallet-telegram-binding.md` §3. |
| `subscriptions.telegram_user_id` lookup p99 spike | Bot prediction latency spikes; engine still accepts request but bot polls block longer. | Inspect SQLite WAL size; rotate WAL via `wal_checkpoint(TRUNCATE)`; if sustained, increase site CPU shares; escalate to C6 to advance Postgres migration ramp. |
| Treasury key compromise (suspected)              | Manual incident; halt watcher (feature flag flip), halt new sessions.                   | Flip `ACCEPT_VIZZOR_PAYMENTS=false` and `ACCEPT_TON_PAYMENTS=false`; sweep treasury balance to cold storage; rotate `VIZZOR_TREASURY_MNEMONIC`; cycle to a fresh treasury address; full incident report. |

---

## 7. Appendix: branch ownership references

For sub-branch agents, the per-branch deliverable contracts are codified in `BRANCHING.md` Section 7 and in the per-branch RFCs at `docs/rfc/v0.2.0/<scope>.md` (authored under each sub-branch). This RFC is normative for cross-cutting concerns only.
