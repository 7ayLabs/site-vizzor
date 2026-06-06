# Incident-response runbook — v0.2.0

Operator runbook for the multi-chain plan-payment surface. Pairs with
`docs/rfc/v0.2.0/crypto-security.md` (threat model) and
`docs/ops/secrets.md` (secrets-management procedures).

## On-call surface

Every alert path below assumes the operator has:

- SSH to the VPS, key-only auth.
- Read access to the secrets manager (Doppler / Infisical / 1Password
  CLI).
- Write access to the on-call Slack / Telegram channel.
- The cold-wallet treasury keys offline. The site host never holds
  private key material in v0.2.0.

## Signals

| Signal | Source | Severity |
|---|---|---|
| `/api/health` returns `status: 'degraded'` with `sqlite.ok: false` | UptimeRobot / BetterStack JSON probe every 60s | P1 — pager |
| `/api/health` returns `status: 'degraded'` with any watcher `stale: true` | same | P2 — chat ping |
| Solana RPC 429 storms in container logs | journalctl / loki | P2 |
| Spike in `wallet_rejected` / `verify_failed` from clients (>10× baseline) | future Sentry / structured-log aggregator | P2 |
| Treasury balance drops (operator-side cold-wallet monitoring) | exchange / cold-wallet alert | P0 — pager |
| Suspected key compromise (mnemonic on host once v0.2.1+) | operator | P0 — pager |

## Kill switches

The fastest stop is the per-chain feature flag. Each rail is gated
independently so a single misbehaving watcher can be quenched without
taking the whole site offline.

```bash
# Disable a single rail (immediate, no restart).
doppler secrets set NEXT_PUBLIC_ACCEPT_USDC_BASE=false
doppler secrets set NEXT_PUBLIC_ACCEPT_VIZZOR_PAYMENTS=false
# Bot routes: drop the shared secret. Returns 503 to the bot until
# the secret is restored.
doppler secrets unset VIZZOR_BOT_SHARED_SECRET
# Watchers reload env on the next process boot. Force a recreate:
ssh vps 'cd /opt/7aylabs && docker compose up -d --no-deps --force-recreate site-vizzor'
```

In-flight pending sessions on the disabled rail will sweep to
`expired` at their existing `expires_at`. They are NOT
auto-refunded; an operator that flips the kill-switch mid-flow
must reconcile manually if any sessions confirmed between the
flag flip and the watcher tear-down.

## P0 procedures

### P0.1 — Treasury balance unexpectedly drops

1. Verify via the chain explorer (basescan / arbiscan / solscan /
   tonscan) that the withdrawal is unauthorised, not a normal
   sweep by the operator.
2. Flip ALL `ACCEPT_*_PAYMENTS=false`. Restart the site container.
3. Sweep remaining treasury balance to cold storage. Time matters
   if the attacker can derive the same address; sweeping wins.
4. Snapshot the SQLite DB (`docker cp site-vizzor:.vizzor/site.db
   /tmp/incident-<ts>.db`) for forensic review.
5. Open a private incident channel; document the timeline as it
   unfolds.
6. Once the host is verified clean and the new treasury is set,
   re-enable rails one at a time.

### P0.2 — Suspected bot-secret leak

1. Set `VIZZOR_BOT_SHARED_SECRET_NEXT` to a fresh 32-byte base64url
   value via the secrets manager.
2. Probe `GET /api/health` to verify the site picked up the rotation
   window.
3. Deploy the bot with `VIZZOR_BOT_SHARED_SECRET` pointed at the new
   value.
4. Probe a bot route with the new secret to confirm; then unset the
   old value.
5. Search audit logs for any grant-redeem / subscription-lookup
   calls between the suspected leak time and rotation. Manually
   reconcile any disputed bindings via direct SQL on `wallet_links`
   + `subscriptions.telegram_user_id`.

## P1 procedures

### P1.1 — `/api/health` reports `sqlite.ok: false`

1. SSH the VPS. `docker compose logs --tail=200 site-vizzor` —
   look for `SQLITE_CORRUPT`, `SQLITE_IOERR`, `EBUSY`, disk
   full, or container-restart loops.
2. If the DB is corrupt: stop the container, restore the latest
   nightly backup from the operator's off-host backup store,
   restart.
3. If the disk is full: identify the offending log volume (`docker
   system df`); prune images older than 72 h.

### P1.2 — Bot routes returning 503 in production

This happens when `VIZZOR_BOT_SHARED_SECRET` is unset. Most likely
cause is a secrets-manager misconfiguration after a deploy.

1. Verify the env in the running container: `docker compose exec
   site-vizzor env | grep BOT_SHARED_SECRET`.
2. If empty, re-inject via the secrets manager and recreate the
   container.

## P2 procedures

### P2.1 — One watcher stuck (`stale: true`)

1. Identify which chain via `/api/health subsystems.watchers`.
2. Tail container logs filtered to that chain prefix
   (`[vizzor-ton-watcher`, `[vizzor-evm-watcher:base`, etc.).
3. Most common: RPC provider returned 429 or 5xx repeatedly. The
   watcher rotates to `*_RPC_URL_FALLBACK` after 3 consecutive
   failures; if both are exhausted you'll see continuous `tick
   failed` entries.
4. Fix: configure a new fallback URL, redeploy, watch the next-tick
   timestamp advance.

### P2.2 — Solana RPC 429 storm

1. Set `SOLANA_RPC_URL` to a dedicated provider (Helius / Triton)
   in the secrets manager.
2. Recreate the container.

## Communication template

Use this exact shape for the on-call channel post:

```
INCIDENT — <P-level> — <one-line title>
Start:  <ISO-8601 ts>
Surface: <site, bot, payment-base, payment-arbitrum, payment-ton, payment-solana>
Symptom: <one sentence>
Impact:  <one sentence>
Action:  <currently executing or just executed>
Next:    <what's next, ETA>
```

Update every 15 minutes for P0, every 30 minutes for P1, every 60
minutes for P2.

## Post-incident

For every P0 and P1: a written post-mortem within 72 hours documenting
timeline, root cause, mitigation, and a follow-up that lands as a
backlog item or a v0.2.x patch. Filed in `docs/incidents/`.
