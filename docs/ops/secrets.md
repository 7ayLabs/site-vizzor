# Secrets Management — v0.2.0

Owner: site-vizzor platform engineering
Companion: `docs/rfc/v0.2.0/infra-hardening.md` §4

This runbook catalogs every secret the v0.2.0 cycle introduces (and the
v0.1.0 secrets that v0.2.0 promotes from "set it on the box" to "manage in a
store"). For each secret: generation procedure, recommended storage,
distribution to the VPS, and rotation procedure.

## 1. Storage recommendation

**Use 1Password CLI (`op`) with `op inject` rendering an env-file template.**

Why 1Password over Doppler / Infisical:

- The operator already runs 1Password for personal credentials, so onboarding
  cost is zero. Doppler and Infisical require new accounts, billing setup, and
  a learning curve for two-person ops.
- `op inject` is template-based: the template is committed (without secrets),
  the operator runs `op inject -i .env.template -o /opt/7aylabs/.env` on the
  VPS, and the resolved file is written with mode 600. No SaaS dependency is
  added.
- Rotation is a single vault edit followed by a re-deploy. No SSH-based file
  editing required.
- Audit log is the 1Password access log, which already exists.
- Personal Items + Vault sharing is enough for a 1-to-2 operator team.

**Override**: if the operator prefers Doppler or Infisical, the wire-up is
the same shape — render an env file on the VPS, point compose at it. The
runbook below uses 1Password verbs (`op inject`, `op item edit`); substitute
your tool's verbs. The site code reads `process.env.*` and is store-agnostic.

## 2. Distribution shape

```
┌────────────────────────────┐         ┌──────────────────────────┐
│  1Password vault           │         │  VPS                     │
│  ─ vizzor-prod             │   op    │  /opt/7aylabs/.env       │
│    ├─ VIZZOR_BOT_SHARED    │ ──────► │  (mode 600, deploy:deploy│
│    ├─ VIZZOR_TREASURY_MN.. │         │   docker:docker)         │
│    ├─ SOLANA_RPC_URL       │         │                          │
│    └─ SENTRY_DSN           │         │  docker compose          │
└────────────────────────────┘         │  reads env_file or       │
                                       │  ${VAR} from this file   │
                                       └──────────────────────────┘
```

`docker-compose.prod.yml` references the values via the `environment:` block
with `${VAR}` interpolation (see
`docs/ops/site-vizzor-compose-snippet.yml`). The file on disk is the only
runtime source; the vault is the source of truth for the next deploy.

## 3. Env-file template (committed in the product repo)

The compose entry expects `/opt/7aylabs/.env` to exist on the VPS. The
recommended template (committed to the product repo, NOT to this repo) is:

```bash
# /opt/7aylabs/.env.template — rendered by `op inject` on each deploy

# ── v0.1.0 baseline ────────────────────────────────────────────────
VIZZOR_SOLANA_TREASURY="op://vizzor-prod/solana-treasury/address"
VIZZOR_TON_TREASURY="op://vizzor-prod/ton-treasury/address"
NEXT_PUBLIC_VIZZOR_MINT="op://vizzor-prod/vizzor-mint/pubkey"

# ── v0.2.0 additions ───────────────────────────────────────────────
SOLANA_RPC_URL="op://vizzor-prod/solana-rpc/url"
NEXT_PUBLIC_SOLANA_RPC_URL="op://vizzor-prod/solana-rpc/url"
VIZZOR_BOT_SHARED_SECRET="op://vizzor-prod/bot-shared-secret/credential"
VIZZOR_TREASURY_MNEMONIC="op://vizzor-prod/treasury-mnemonic/mnemonic"
VIZZOR_HD_DERIVATION_ENABLED="false"
SENTRY_DSN="op://vizzor-prod/sentry-site-vizzor/dsn"
SENTRY_TRACES_SAMPLE_RATE="0.05"

# ── persistent state ───────────────────────────────────────────────
VIZZOR_SITE_DB="/app/.vizzor/site.db"
NODE_ENV="production"
NEXT_PUBLIC_VIZZOR_API_URL="https://api.vizzor.ai"
```

Rendering:

```
op inject -i /opt/7aylabs/.env.template -o /opt/7aylabs/.env
chmod 600 /opt/7aylabs/.env
chown deploy:docker /opt/7aylabs/.env
```

## 4. Secret catalog

### 4.1 `VIZZOR_BOT_SHARED_SECRET`

**Introduced by**: C2 wallet-telegram-binding (see
`docs/rfc/v0.2.0/wallet-telegram-binding.md` §7).
**Scope**: server-only. The same value lives on both the site and the
Telegram bot.

**Generation**:

```
node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))'
```

Run on a trusted workstation. 32 bytes of CSPRNG entropy, base64url-encoded.

**Storage**: 1Password item `vizzor-prod/bot-shared-secret`, field
`credential`. The bot host's deploy mechanism reads the same value from the
same vault.

**Distribution**: `op inject` writes it into `/opt/7aylabs/.env`. Compose
passes it as `VIZZOR_BOT_SHARED_SECRET=${VIZZOR_BOT_SHARED_SECRET}`.

**Rotation**: per `docs/rfc/v0.2.0/wallet-telegram-binding.md` §7. Two-phase:

1. Generate the new secret. Add it to the vault as a second field on the same
   item (`credential_next`).
2. Update the site's `.env.template` to inject the new value as
   `VIZZOR_BOT_SHARED_SECRET_NEXT` alongside the current
   `VIZZOR_BOT_SHARED_SECRET`. Re-render and re-deploy the site. (The site
   code from C2's auth middleware accepts either value during the rotation
   window.)
3. Update the bot's deployment to use `credential_next` as its
   `VIZZOR_BOT_SHARED_SECRET`. Verify a probe call succeeds.
4. Promote `credential_next` to `credential` in the vault, remove
   `credential_next`, drop the `_NEXT` line from the template, re-render,
   re-deploy.

### 4.2 `VIZZOR_TREASURY_MNEMONIC`

**Introduced by**: C1 web3-purchase-flow (deferred until C4 audit clears, per
`docs/rfc/v0.2.0/architecture.md` §5).
**Scope**: server-only. Highest-blast-radius secret in the system — a leak
means anyone can derive every per-session treasury address and watch them.

**Generation**: a fresh 24-word BIP-39 mnemonic. Generate on a hardware
wallet (Ledger, Trezor) or on an air-gapped workstation. Never paste it into
a terminal connected to the internet.

```
# Trusted air-gapped workstation only
node -e "console.log(require('bip39').generateMnemonic(256))"
```

**Storage**: 1Password item `vizzor-prod/treasury-mnemonic`, field
`mnemonic`. Mark the item as "Auto-Submit: Never". Access logged.

**Distribution**: `op inject`. Compose passes
`VIZZOR_TREASURY_MNEMONIC=${VIZZOR_TREASURY_MNEMONIC}`. The site reads it
once at first watcher tick after `VIZZOR_HD_DERIVATION_ENABLED=true`.

**Rotation**: this is a key-rotation event with real on-chain consequences.

1. Generate a new mnemonic on the air-gapped workstation.
2. Derive the first 100 per-session addresses from the OLD mnemonic and write
   them to a watchlist. Run a Solana balance check on each one — sweep any
   non-zero balances to the new mnemonic's root address.
3. Update the vault item. Re-render the env file. Re-deploy.
4. The watcher will derive new addresses from the new mnemonic on every new
   session. Pending sessions whose `dest_address` was derived from the old
   mnemonic will still confirm because the per-session `dest_address` is
   persisted in `payment_sessions.dest_address` and the watcher matches by
   memo + amount, not by current-mnemonic-derived address.

### 4.3 `SOLANA_RPC_URL` (and `NEXT_PUBLIC_SOLANA_RPC_URL`)

**Introduced by**: this branch (C6). Replaces the public mainnet-beta
default. See `docs/rfc/v0.2.0/infra-hardening.md` §3.
**Scope**: server-side. The `NEXT_PUBLIC_*` mirror exists for the rare
client-side codepath (today only the wallet adapter consumes it in some
configurations); it carries the same value because the URL itself is the
auth — providers like Helius embed an API key in the URL path.

**Generation**: not generated locally — provisioned by the provider. The
operator signs up with Helius / Triton / QuickNode, creates a project,
copies the HTTPS endpoint URL.

**Storage**: 1Password item `vizzor-prod/solana-rpc`, field `url`. Treat as a
secret because rotating it requires provider involvement.

**Distribution**: `op inject`. Both `SOLANA_RPC_URL` and
`NEXT_PUBLIC_SOLANA_RPC_URL` are set from the same vault field.

**Rotation**:

1. In the provider dashboard, rotate the project's API key. Most providers
   issue a new URL.
2. Update the vault field with the new URL.
3. Re-render the env file. `docker compose up -d --force-recreate site-vizzor`.
4. The watcher reads the new URL on next start. There is no in-process cache
   to invalidate.

If the provider supports overlapping keys (two URLs valid simultaneously),
prefer that flow: update vault, re-deploy, then revoke the old URL once the
new deploy is green. This avoids a downtime window if the re-deploy fails.

### 4.4 `SENTRY_DSN`

**Introduced by**: this branch (C6). Optional in dev; required (per the env
registry in `docs/rfc/v0.2.0/architecture.md` §5) in production with the
nuance that absence emits a warning, does NOT fail health.
**Scope**: server-side (the `@sentry/nextjs` server-side instrumentation
reads it).

**Generation**: not generated locally — provisioned by Sentry. The operator
creates a project at `sentry.io` (or self-hosted), copies the DSN.

**Storage**: 1Password item `vizzor-prod/sentry-site-vizzor`, field `dsn`.

**Distribution**: `op inject`. Compose passes `SENTRY_DSN=${SENTRY_DSN}`. If
the value is empty, the Sentry SDK is a no-op.

**Rotation**: regenerate the DSN in the Sentry project settings. Update the
vault field. Re-render and re-deploy. Old events keep landing under the old
DSN until the deploy completes — no data loss.

### 4.5 v0.1.0 secrets promoted into the runbook

These were set on the VPS by hand in v0.1.0. v0.2.0 promotes them into the
1Password vault for consistency and rotation hygiene. The values do not
change; only the storage and rotation procedure do.

| Secret                       | Why it's secret-ish                                                |
|------------------------------|--------------------------------------------------------------------|
| `VIZZOR_SOLANA_TREASURY`     | Public on-chain address, but leaking it before launch tips users to a not-yet-public deployment. Move to vault for environment isolation between staging/prod. |
| `VIZZOR_TON_TREASURY`        | Same as Solana.                                                    |
| `NEXT_PUBLIC_VIZZOR_MINT`    | Public on-chain identifier; managed via vault for environment isolation. |

These do not require rotation. The vault item is the source of truth so
staging and prod cannot accidentally point at the same address.

## 5. Log redaction rules

The site MUST NOT log the following, ever:

- **SIWS messages**: the canonical message built by `buildSiwsMessage` in
  `lib/payment/siws.ts`. The message contains the user's wallet, a nonce,
  and timestamps. Logging it reveals the nonce, which is the only thing
  preventing signature replay until C4's durable replay cache lands.
- **SIWS signatures**: the 64-byte ed25519 output. A leaked signature plus
  the message lets an attacker replay the auth until the nonce is consumed.
- **Private keys, mnemonics, or derivation paths**: any string that could
  reconstruct treasury custody. Includes `VIZZOR_TREASURY_MNEMONIC`,
  derivation indices, and any intermediate output of HD derivation.
- **Raw request bodies of `POST /api/auth/siws/verify`**: contains the
  signature and the wallet — see above.
- **Raw values of `VIZZOR_BOT_SHARED_SECRET`** or any header value that
  carries it. Log only `accepted: true|false` outcomes.

**Implementation guidance**: the Sentry SDK is configured with `beforeSend`
that strips known-sensitive keys (`signature`, `message`, `siws_token`,
`mnemonic`, `secret`, `token`, `nonce`) from event payloads. The
`@sentry/nextjs` `Replay` integration is disabled — recording the DOM of a
checkout flow risks capturing wallet-adapter modals that display addresses
and partial signatures.

For local `console.*` calls, the convention is:

```ts
// BAD
console.log('verify', { message, signature });
// GOOD
console.log('verify', { walletPrefix: wallet.slice(0, 4), accepted: ok });
```

The repo's lint rule should flag direct logging of these names; until that
rule is wired (out of cycle scope), reviewers enforce by hand.

## 6. Verification

After provisioning a new VPS or rotating any secret:

```
# On the VPS
op inject -i /opt/7aylabs/.env.template -o /opt/7aylabs/.env
test "$(stat -c %a /opt/7aylabs/.env)" = "600"           # mode 600
test "$(stat -c %U /opt/7aylabs/.env)" = "deploy"        # owned by deploy
grep -q SOLANA_RPC_URL /opt/7aylabs/.env                 # value present
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --force-recreate site-vizzor
sleep 20
curl -s http://127.0.0.1:7120/api/health | jq '.checks'
# {db: "ok", snapshot: {fresh: true|false}, solanaRpc: {reachable: true}}
```

If `solanaRpc.reachable` is `false`, the value resolved into the env file
is wrong (typo or expired API key). Roll back per
`docs/ops/rollback.md` and re-render.
