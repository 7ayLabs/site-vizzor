# Directory ops runbook

Operator-facing reference for the `/app/directory` connector store
shipped on `feat/v0.4.1/connector-directory`.

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
