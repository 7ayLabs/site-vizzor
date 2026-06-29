# Directory ops runbook

Operator-facing reference for the `/app/directory` connector store
shipped on `feat/v0.4.1/connector-directory`.

## Production-readiness audit (as of 2026-06-29)

What ships on the current branch:
- 6 connectors · 9 skills · 3 plugins, parity-checked across repos.
- Tier-gated install + skill activation (free/pro/elite), server-enforced at site + engine.
- AES-256-GCM credential storage with SSRF-guarded outbound dispatch.
- Personal MCP token mint (Elite).
- Export / import endpoints.
- Branded dispatch envelope (Vizzor source block + referral attribution).
- Tabbed Claude-style `+` picker in the chat composer with fluid transitions.

Blockers before flipping the branch to main:
1. **Engine deploy gap.** All engine commits are on `feat/v0.4.1/connector-directory`. `api.vizzor.ai` still runs from `main` (last commit `59c81b2`). Until the engine deploys, `skill_id` is honored ONLY through the site-side priming workaround (`lib/directory/runtime.ts:buildSkillPrimingMessages`). Plan: merge engine PR + redeploy, then drop the priming map in a follow-up commit.
2. **`CONNECTOR_ENC_KEY` env var.** AES-256-GCM key for `lib/security/connector-crypto.ts`. Not yet provisioned in prod env. Generate via `openssl rand -base64 32` and store in 1Password / fly secrets BEFORE the first install attempt — otherwise the POST /install route throws at the first webhook install.
3. **Plugin scaffolding only.** `pluginsForTarget()` resolves ids on the engine side but no signal gatherer reads it. UI carries a "Reserved" badge to be honest about this. Closing it requires server-to-server forwarding of the user's encrypted key from site → engine, plus per-gatherer fetch-path adapters. Ship as v0.4.2.
4. **No E2E test for the directory flow.** Unit tests cover crypto, SSRF, catalog validation, tier gating, and weight math (59 site + 16 engine tests). End-to-end (install Discord webhook → activate skill → send chat → confirm webhook delivery) requires Playwright + a local engine stub. Manual smoke is the current gate.
5. **Site PR not opened.** User instruction: keep on `feat/v0.4.1/connector-directory`. When ready, open against `develop` first, then `develop → main` is its own release gate.

Operational warm-up checklist before announcing:
- [ ] `CONNECTOR_ENC_KEY` set in prod.
- [ ] Engine feature branch merged to `develop` + redeployed.
- [ ] `pnpm exec tsc --noEmit` clean on both repos at HEAD.
- [ ] `pnpm vitest run tests/lib` (site) + `pnpm vitest run test/unit` (engine) green.
- [ ] `SITE_CATALOG_URL=https://vizzor.ai/api/directory/catalog node scripts/check-directory-parity.mjs` green from a workstation.
- [ ] `/api/directory/catalog` returns 200 (anonymous) with cached headers.
- [ ] Manual: install one webhook connector, watch the connector's endpoint receive a POST after a chat.
- [ ] Manual: activate Memecoin Sniper, ask chat for "what skill is active" — model names the skill.
- [ ] Audit log row for `directory.install` lands on every install.
- [ ] Rotate any test API keys / webhooks before going public.

Known follow-up workstreams (post v0.4.1):
- Full prediction-markets surface (`/app/markets` page, Polymarket data fetcher, dedicated chat composer chips). The `prediction-markets` skill is a v0.4.1-scope MVP that reuses the existing chronovisor pipeline; the dedicated surface is v0.5.
- Plugin wire-up to signal gatherers (the deferred work above).
- Nostr signer service deployed at vizzor.ai (today users must run their own bridge). NIP-46 delegated signer flow.
- Telegram broadcast bot template repo so users can deploy a channel bot in one click.
- Per-skill accuracy badges on directory cards (engine `accuracy-tracker.ts` already records hit rate per-skill via `chronovisor_predictions.skill_id`).
- E2E Playwright suite for install / activate / dispatch flows.
- ENS-resolved webhook targets (`https://you.eth`).

## What the directory is

A curated allowlist of Skills, Connectors, and Plugins listed at
`data/connectors.json`. Each entry tells the UI how to render and the
API how to validate an install. Three categories form the input →
engine → output pipeline:

| Tab | Where it sits | Effect |
|---|---|---|
| **Plugins** | Upstream of the engine | RPC + feed overrides routed via `plugin_ids` on the predict request |
| **Skills** | Inside the engine | `active_skill_id` adjusts signal weights + prompt prefix |
| **Connectors** | Downstream of the engine | Site-side webhook fan-out via `lib/directory/runtime.dispatchPrediction` |

## Catalog edits

The catalog is the single source of truth. To add or remove an entry:

1. Edit `data/connectors.json`. Keep `version` monotonic — bump if
   the schema changes shape, leave as is for entry-only edits.
2. Drop a SVG at `public/connectors/<slug>.svg` matching the `icon`
   field.
3. Run `pnpm vitest run tests/lib/directory` — the catalog loader
   throws on malformed entries at module init and the tests cover the
   schema invariants.
4. If the entry is a **skill** or a **plugin**, mirror it on the
   engine repo at the matching registry file
   (`src/core/chronovisor/skills.ts` or `src/data/plugins/registry.ts`).
   The CI parity check (`scripts/check-directory-parity.mjs`) will
   fail the merge otherwise.

## Encryption key rotation

Connector credentials are AES-256-GCM blobs keyed off
`CONNECTOR_ENC_KEY` (base64 of 32 random bytes).

To rotate:

1. Generate the new key: `openssl rand -base64 32`.
2. Stand it up alongside the old key in the deploy env as
   `CONNECTOR_ENC_KEY_NEXT`.
3. Run the re-encryption script (TBD; one-shot scan of
   `user_connections` that decrypts with the old key and re-encrypts
   with the new). For v1 we have not yet shipped the helper — the
   plan is to write `scripts/rotate-connector-key.mjs` when the first
   rotation is required.
4. Swap `CONNECTOR_ENC_KEY` to the new value, remove
   `CONNECTOR_ENC_KEY_NEXT`, redeploy.

Until the rotation script ships, treat the initial key as
non-rotatable — if it leaks, the only safe recovery is to mass-revoke
every active row (`UPDATE user_connections SET status='revoked'
WHERE status='active'`) and have users re-install.

## Dispatch circuit breaker

Outbound webhook fan-out (`dispatchPrediction`) is best-effort. A
failure is logged to `audit_log` with event_type
`directory.connector.circuit_open` but never blocks the predict path.

Today there is no formal pause/recover state — every prediction
attempts every active webhook. If a single user's webhook is down
they will see one failed POST per prediction. The v1.1 plan is a
3-strike pause for 5 minutes (per the design doc); track in the
audit table to see if anyone is hitting the pattern at scale before
investing.

## Common errors

| Symptom | Likely cause |
|---|---|
| `ssrf_blocked` on install | User pasted an internal URL (127.0.0.1, AWS metadata, RFC1918). Expected — refuse. |
| `invalid_webhook_url` on Discord install | User pasted a non-`discord.com/api/webhooks/` URL. Surface the field-level hint. |
| 401 on every directory write | SIWS session expired. UI should kick to the wallet connect flow. |
| 429 on install burst | `directory.write` bucket (5/min) hit. Tell the user to wait. |
| Skill activates but engine ignores it | Engine registry missing the entry. Run the parity check. |
| Catalog empty in the UI | `/api/directory/catalog` failing — check `pnpm exec tsx node -e 'require("./lib/directory/catalog").loadCatalog()'` for a parse error. |

## Schema cheatsheet

```
user_connections (
  id BLOB PK
  wallet_address TEXT
  connector_id TEXT     -- matches data/connectors.json:entries[].id
  status TEXT           -- 'active' | 'paused' | 'revoked'
  credentials_ciphertext BLOB
  credentials_iv BLOB
  credentials_tag BLOB
  scopes TEXT (JSON)
  installed_at INTEGER
  last_used_at INTEGER
  revoked_at INTEGER
)

wallet_preferences (
  wallet_address TEXT PK
  active_skill_id TEXT
  updated_at INTEGER
)
```

## Tier ↔ /pricing alignment (v0.4.1)

Single source of truth: `data/connectors.json` (site) and
`src/core/chronovisor/skills.ts` + `src/data/plugins/registry.ts` (engine).
`scripts/check-directory-parity.mjs` fails the build if `required_tier` drifts
between any matched entry across the two repos.

| Catalog entry | Category | `required_tier` | Maps to pricing feature |
|---|---|---|---|
| `telegram` | connector | free | included with trial / lapsed accounts |
| `discord-webhook` | connector | free | included with trial / lapsed accounts |
| `nostr` | connector | free | **web3-native social**, user runs a self-hosted relay bridge (no nsec on Vizzor) |
| `memecoin-sniper` | skill | free | trial skill |
| `solana-native` | skill | free | trial skill — Solana-first bias |
| `degen-hours` | skill | free | trial skill — off-hours microstructure bias |
| `coingecko-meta` | plugin | free | basic data feed |
| `farcaster` | connector | pro | Warpcast via Neynar (paid feed, paid users) |
| `telegram-channel` | connector | pro | broadcast variant — your own bot, your own channel |
| `conservative-trend` | skill | pro | "4 calibrated prediction tiers" |
| `cult-mode` | skill | pro | community-driven reasoning |
| `helius-rpc` | plugin | pro | upgraded data path (reserved until gatherer wires) |
| `dexscreener-flow` | plugin | pro | upgraded flow feed (reserved) |
| `whale-tracker` | skill | elite | "Whale Terminal" |
| `flow-driven` | skill | elite | "Smart Money Flow · Cross-venue intelligence" |
| `diamond-hands` | skill | elite | long-horizon conviction filter — sub-week predictions return as hold |
| `vizzor-mcp` | connector | elite | **"REST API + priority queue"** — MCP is the v0.4.1 surface |

### Web3 alignment notes

- **No Web2 connectors.** Slack and the generic webhook were dropped
  in this iteration. Output rails are Telegram (DM + channel), Discord
  (webhook is anon by design), Farcaster (Web3 social via Neynar),
  Nostr (sovereign relay), or Vizzor MCP (agent surface).
- **Nostr never holds your nsec.** `install_kind: 'webhook'` and the
  field is a relay-bridge HTTPS endpoint the user controls. Any open-
  source nostr signer (njump, nostr-rs-relay, NIP-46) works. AES-256-GCM
  still encrypts the bridge URL; `safeFetch` runs the SSRF deny-list
  before any outbound dial.
- **Vizzor-original skills** ship with real `signalWeightOverrides` —
  the engine reasons measurably differently when one is active. See
  `src/core/chronovisor/skills.ts` for the exact weight deltas vs the
  fallback set.

The `pricing.tiers.{tier}.features.directory` i18n key on /pricing surfaces
this directly so a wallet buying Pro / Elite knows the Directory entries
that ladder in. Update both this table and the i18n bullets if a new entry
is added or an existing one moves tier.

Enforcement points (every entry hit by a caller goes through at least one):
- Site `POST /api/directory/install` — `tierGateForEntry(entry, effective)` → 402.
- Site `PATCH /api/directory/skills/active` — same gate.
- Site `POST /api/directory/import` — refused entries land in `to_install` with `reason: 'tier_required'`.
- Site `POST /api/directory/mcp/token` — gated by the MCP catalog entry's tier.
- Engine `/v1/chat` — `resolveSkillForTier(skillId, jwtTier)` throws `TierRequiredError` → 402.
- UI catalog response carries `locked: boolean` (advisory only) so cards render an upgrade chip.

## What actually works end-to-end today

Reality check after the `feat/v0.4.1/connector-directory` branches merge:

### Skills — fully wired

| Entry | Weight overrides | Prompt prefix | Status |
|---|---|---|---|
| `memecoin-sniper` | ✅ applied in `engine.predict` (mergeWeights) | ✅ prepended in `buildTaskAwareChatSystemPrompt` | works |
| `whale-tracker` | ✅ | ✅ | works |
| `conservative-trend` | ✅ | ✅ | works |
| `flow-driven` | ✅ | ✅ | works |

End-to-end sequence:

1. User clicks `+` on a skill card in `/app/directory`.
2. UI calls `PATCH /api/directory/skills/active` with the `skill_id`.
3. Server validates the id against the catalog (`isKnownSkill`), upserts
   `wallet_preferences.active_skill_id` for the SIWS-authenticated wallet,
   audit-logs `directory.skill.activated`.
4. Next time the wallet hits `/api/predict`, the route reads
   `getActiveSkillId(wallet)` from `wallet_preferences` and forwards it
   to the engine in the `/v1/chat` body as `skill_id`.
5. Engine `chat.ts` resolves the skill via `resolveSkill(skill_id)`. Unknown
   id → 400 `unknown_skill`. Known id → the skill's `systemPromptPrefix`
   is threaded into `buildTaskAwareChatSystemPrompt` (lines 414-421) and
   prepended to the system prompt above the site-locale block so it
   carries authoritative weight.
6. Inside the same predict pipeline, `engine.predict()` resolves the
   same skill from its `opts.skillId` and deep-merges
   `signal_weight_overrides` onto the per-horizon `blendedWeights`
   before `applyWeights` + `computeComposite` run. The `signalBreakdown`
   the UI surfaces matches the post-merge math.

### Connectors — partially wired

| Entry | Dispatch path | Status |
|---|---|---|
| `telegram` | existing `wallet_links` + `pending_notifications` (engine repo); paired wallets receive on-demand bot output today | works **today via the existing pair flow**; broadcast fan-out to paired wallets is a separate roadmap item |
| `discord-webhook` | site-side `dispatchPrediction` via `safeFetch` | works after install — fires once per `/api/predict` stream close |
| `slack-webhook` | same | works after install |
| `generic-webhook` | same | works after install |

End-to-end sequence (Discord / Slack / generic):

1. User clicks `+` on the connector card → install sheet collects the
   webhook URL.
2. POST `/api/directory/install` validates the URL against the entry's
   schema (regex for Discord/Slack hosts), runs `validateOutboundUrl`
   for SSRF protection, encrypts the payload with AES-256-GCM, inserts
   `user_connections` row with `status='active'`.
3. When the wallet runs a chat, `/api/predict` calls the engine, pipes
   the SSE response back to the client, and on stream close
   `dispatchPrediction(ctx.wallet, payload)` fires. The fan-out reads
   every active webhook for the wallet, decrypts its URL, posts a JSON
   body via `safeFetch` with a 3.5s timeout, and audit-logs failures as
   `directory.connector.circuit_open`. Per-connector failures are
   isolated; the user's chat reply never blocks on dispatch.

### Plugins — scaffolding only, no behavior change yet

| Entry | Resolver | Behavior change | Status |
|---|---|---|---|
| `helius-rpc` | ✅ `resolvePlugins` (engine) | ❌ `solana-whale-monitor` still reads `HELIUS_API_KEY` env | scaffolding |
| `dexscreener-flow` | ✅ | ❌ `dex-pair-tracker` still reads `DEXSCREENER_BASE` env | scaffolding |
| `coingecko-meta` | ✅ | ❌ `token-resolver` still reads `COINGECKO_API_KEY` env | scaffolding |

The boundary contract is in place: a wallet's plugin selection flows
from `/api/directory/catalog` → `wallet_preferences`/`user_connections`
→ `/api/predict` body `plugin_ids` → `chat.ts` (the chat route receives
them; see `void pluginIdsRaw`) → engine `resolvePlugins`. The remaining
hookup — signal gatherers reading `pluginsForTarget()` and substituting
the user's API key in their fetch path — requires a server-to-server
key forwarding channel (the user's encrypted credentials live on the
site, not the engine). Marked as deferred until that surface ships.
A user who installs `helius-rpc` today sees `Installed` in the UI and
the choice is audit-logged, but predictions reason against the engine's
default RPC.

## Where to look in code

- Catalog loader + types: `lib/directory/catalog.ts`
- Install validation: `lib/directory/validate.ts`
- Runtime helpers (hydrated catalog, dispatch): `lib/directory/runtime.ts`
- Crypto: `lib/security/connector-crypto.ts`
- SSRF guard: `lib/security/safe-fetch.ts`
- API routes: `app/api/directory/{catalog,install,skills}`
- UI shell: `app/[locale]/app/directory/{page,directory-shell,install-sheet}.tsx`
- Sidebar entries: `components/app/{app-sidebar,product-sidebar,app-shell-rail}.tsx`
- DB migration + helpers: `lib/payment/db.ts` (`runV041DirectoryMigrations`)
- Audit events: `lib/payment/audit.ts` (`directory.*`)
- Rate limits: `lib/payment/rate-limit.ts` (`directory.read`, `directory.write`)
