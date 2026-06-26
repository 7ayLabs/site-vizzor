# Mainnet Flip Checklist — v0.4.0

_Operator-facing. Run this sequentially. Do not skip steps. If any
verification fails, **abort and roll back** before proceeding._

This checklist covers the moment we flip
`accept_solana_payments=true` for mainnet. It assumes the
`release/v0.4.0-mainnet-launch` PR has merged to `main` and the
GHCR rebuild has completed.

Companion docs:
- [`disaster-recovery.md`](./disaster-recovery.md) — VPS-lost scenario
- [`rollback.md`](./rollback.md) — sub-5-minute revert procedure
- [`../security/vps-hardening.md`](../security/vps-hardening.md) — ufw / fail2ban / sshd
- [`./treasury-setup.md`](./treasury-setup.md) — pool provisioning

---

## Phase 0 — Preflight (T-15 min)

All of the following must be **green** before the flip commit lands.

### 0.1 Engine middleware

The engine `main` branch must carry the `/v1/internal/*` exclusion
(`4bb73d5`) and the health-payments diagnostic (`eb232bf`).

```bash
gh api repos/7ayLabs/vizzor/commits/main --jq '.sha'
cd /Users/mac/Desktop/Zaid/empresa/proyectos/repos/vizzor
git log origin/main --oneline | head -10
# expect 4bb73d5 + eb232bf present
```

### 0.2 VPS environment

SSH to the VPS and confirm the following keys exist in
`/opt/7aylabs/.env`:

| Key | Notes |
|---|---|
| `VIZZOR_BOT_TOKEN` | shared secret with the engine, ≥ 16 chars |
| `VIZZOR_BOT_SHARED_SECRET` | same value, site-side env name |
| `SOLANA_RPC_URL_MAINNET` | paid Helius / Triton (not public RPC) |
| `VIZZOR_SOLANA_TREASURY_MAINNET` | operator-controlled mainnet pubkey |
| `VIZZOR_SOLANA_ADDRESS_POOL_PATH` | absolute path to the pool JSON |
| `VIZZOR_SOLANA_POOL_SHA256` | sha256 of the pool JSON (out-of-band) |
| `SANCTIONS_FAIL_CLOSED` | `true` |
| `VIZZOR_SITE_DB` | `/app/.vizzor/site.db` (bind-mounted volume) |

```bash
ssh deploy@vps "grep -E '^(VIZZOR_BOT_TOKEN|VIZZOR_BOT_SHARED_SECRET|SOLANA_RPC_URL_MAINNET|VIZZOR_SOLANA_TREASURY_MAINNET|VIZZOR_SOLANA_ADDRESS_POOL_PATH|VIZZOR_SOLANA_POOL_SHA256|SANCTIONS_FAIL_CLOSED)=' /opt/7aylabs/.env | sort"
```

### 0.3 Pool integrity

The pool file must be mode `0600`, owned by `deploy:deploy`, and its
sha256 must match the digest recorded out-of-band.

```bash
ssh deploy@vps "stat -c '%a %U:%G %n' \$VIZZOR_SOLANA_ADDRESS_POOL_PATH"
# expect: 600 deploy:deploy /opt/7aylabs/secrets/sol-pool.json

ssh deploy@vps "sha256sum \$VIZZOR_SOLANA_ADDRESS_POOL_PATH"
# compare against your offline copy of VIZZOR_SOLANA_POOL_SHA256
```

### 0.4 Treasury wallet balance + claim window

Mainnet treasury must hold ≥ 0.05 SOL for rent / fees. The pool
must have ≥ 100 unconsumed addresses (claim window covers ≥ 30
days of expected sign-ups).

```bash
# Pool consumption snapshot
ssh deploy@vps "sudo docker exec site-vizzor sqlite3 /app/.vizzor/site.db \
  \"SELECT COUNT(*) AS consumed FROM pool_claims WHERE chain='solana';\""
# Subtract from total entries in the pool JSON; ensure remainder ≥ 100.
```

### 0.5 Sanctions feed populated

```bash
ssh deploy@vps "sudo docker exec site-vizzor sqlite3 /app/.vizzor/site.db \
  'SELECT COUNT(*) FROM sanctioned_addresses;'"
# expect > 1000
```

### 0.6 TON watcher liveness accessor

Even though TON mainnet remains off this sprint, the accessor must
report a non-null `lastTickAt` on staging.

```bash
curl -s https://app.staging.vizzor.ai/api/health | jq '.subsystems.tonWatcher.lastTickAt'
# non-null integer
```

### 0.7 Webhook end-to-end against staging

```bash
TOK=$(ssh deploy@vps "sudo grep VIZZOR_BOT_TOKEN /opt/7aylabs/.env.staging | cut -d= -f2")
curl -s -X POST https://api.staging.vizzor.ai/v1/internal/subscription-updated \
  -H "X-Vizzor-Bot-Token: $TOK" \
  -H "Idempotency-Key: preflight-$(uuidgen)" \
  -H "Content-Type: application/json" \
  --data '{"wallet":"4LDJYjzvrYiaYjFQwDt77Pi8945BEwLejqiPkN8ye2ff","tier":"pro"}'
# expect {"ok":true,"invalidated":1}
```

### 0.8 Security headers present

```bash
curl -sI https://app.staging.vizzor.ai/pay/pro/monthly \
  | grep -iE "content-security-policy|strict-transport-security|x-frame-options"
# all three present
```

### 0.9 UptimeRobot monitors green

Confirm in the vendor dashboard that both monitors
(`https://app.vizzor.ai/api/health`, `https://api.vizzor.ai/health`)
have been green for the prior 30 min.

### 0.10 Backup ran tonight

```bash
ssh deploy@vps "ls -la /opt/7aylabs/backups/ | tail -3"
# expect a fresh .age file with last night's date
```

---

## Phase 1 — The flip (T-0)

Edit `.github/workflows/deploy.yml`:

```yaml
case "${{ github.ref_name }}" in
  main)
    echo "ACCEPT_SOLANA_PAYMENTS=true" >> $GITHUB_ENV
    echo "VIZZOR_NETWORK=mainnet-beta" >> $GITHUB_ENV
    ;;
  testing)
    echo "ACCEPT_SOLANA_PAYMENTS=true" >> $GITHUB_ENV
    echo "VIZZOR_NETWORK=devnet" >> $GITHUB_ENV
    ;;
esac
```

Open the flip PR, get one approver, **squash-merge**. The deploy
workflow rebuilds and pushes the new image; the VPS pulls and
recreates `site-vizzor`.

---

## Phase 2 — Smoke (T+5 min)

### 2.1 Container is up

```bash
ssh deploy@vps "sudo docker compose ps site-vizzor"
# state: Up (healthy)
```

### 2.2 Health endpoint green

```bash
curl -s https://app.vizzor.ai/api/health | jq '.'
# .status == "ok"
# .subsystems.solanaWatcher.lastTickAt = non-null int
# .subsystems.sanctionsFeed.ok = true
# .subsystems.addressPool.ok = true
```

### 2.3 Boot-time audit log lines present

```bash
ssh deploy@vps "sudo docker logs site-vizzor 2>&1 | grep -E 'pool sha256 verified|sanctions feed loaded|VIZZOR_BOT_TOKEN configured'"
```

### 2.4 Pool integrity log line

```bash
ssh deploy@vps "sudo docker logs site-vizzor 2>&1 | grep -i 'pool sha256 verified'"
```

### 2.5 Webhook smoke against prod

```bash
TOK=$(ssh deploy@vps "sudo grep VIZZOR_BOT_TOKEN /opt/7aylabs/.env | cut -d= -f2")
curl -s -X POST https://api.vizzor.ai/v1/internal/subscription-updated \
  -H "X-Vizzor-Bot-Token: $TOK" \
  -H "Idempotency-Key: postflip-$(uuidgen)" \
  -H "Content-Type: application/json" \
  --data '{"wallet":"4LDJYjzvrYiaYjFQwDt77Pi8945BEwLejqiPkN8ye2ff","tier":"pro"}'
# expect {"ok":true,"invalidated":1}
```

---

## Phase 3 — Real $0.50 test (T+10 min)

1. From the operator's mainnet wallet, hit
   `https://app.vizzor.ai/pay/pro/monthly?test=1&discount=99`.
2. Approve the SOL transfer in Phantom.
3. Watch the `/pay` page flip to "Payment confirmed" within 30 s.
4. The Telegram bot's `/status` must show `PRO` within 2 s of confirmation
   (the engine webhook fired).
5. The grant code displayed on `/pay` redeems against the bot via
   `/redeem <code>`.

Audit the row landed:

```bash
ssh deploy@vps "sudo docker exec site-vizzor sqlite3 /app/.vizzor/site.db \
  \"SELECT session_id, status, tx_sig, payer_address, tier, cadence
    FROM payment_sessions ORDER BY created_at DESC LIMIT 1;\""
```

---

## Phase 4 — Monitor (T+15 min → T+75 min)

For one full hour:

1. UptimeRobot dashboard refresh every 5 min — both monitors green.
2. `journalctl -u docker -f` for restarts.
3. `curl -s https://app.vizzor.ai/api/health` every 5 min.
4. `tail -F /opt/7aylabs/logs/site-vizzor.log` for `ERROR` lines.
5. Engine `/v1/internal/health-payments` returns `siteReachable: true`.

If anything misbehaves, follow [`rollback.md`](./rollback.md). Funds
are never at risk during rollback — the watcher state survives an
image swap because SQLite lives on a bind-mounted volume.

---

## Abort criteria — roll back immediately

- Pool sha256 mismatch in the boot log.
- Sanctions feed unreachable AND `SANCTIONS_FAIL_CLOSED=true` (process
  refuses to start).
- Watcher `lastTickAt` is older than 5 min in `/api/health`.
- Any 5xx burst on `/pay/*` for > 60 s.
- Engine `/v1/internal/health-payments` reports `siteReachable: false`
  for > 2 min.
- Real test payment does not flip to confirmed within 5 min.

---

## After the monitor window

- Tag the release: `git tag v0.4.0-mainnet && git push --tags`.
- Post operator summary in the ops channel: total test payments,
  treasury balance, pool consumption delta, any incidents.
- Schedule the post-launch review for T+24h.
