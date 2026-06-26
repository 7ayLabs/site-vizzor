# Disaster Recovery — VPS Lost

_Operator-facing. Pair with [`vps-bootstrap-site-vizzor.md`](./vps-bootstrap-site-vizzor.md)
for the green-field bootstrap procedure._

This document covers the **VPS lost** scenario: the host is
unreachable, compromised, or destroyed, and we need to bring the
site back up on a fresh box from off-host encrypted backups.

The site state that matters:

- `site.db` (SQLite) — payment_sessions, subscriptions, grants,
  wallet_links, audit log, sanctioned_addresses table, address
  pool consumption pointers. **All money-touching state.**
- `/opt/7aylabs/.env` — secrets (bot tokens, RPC URLs, treasury
  pubkeys). **Required to start the stack.**
- `/opt/7aylabs/secrets/*.json` — pool JSON files. **Required
  for the watch-only treasury to allocate addresses.**

Everything else (compose file, images, nginx config) is checked
into git and pulled from GHCR.

---

## Recovery objectives

| Metric | Target |
|---|---|
| RPO (data loss window) | ≤ 24h (nightly backup cadence) |
| RTO (downtime) | ≤ 2h on a fresh VPS |
| Funds at risk during outage | **0** — payers' funds stay in their own wallets until they sign |

In-flight `pending` sessions during the outage expire after the
rate-lock window (15 min default). Users who paid against an
expired session can retry; on-chain payments to expired-session
addresses get routed to manual reconciliation via the audit log.

---

## Prerequisite: the off-host backup recipient

`docs/security/vps-hardening.md` documents the nightly backup
pipeline. The salient bits for recovery:

- `/usr/local/bin/vizzor-db-backup.sh` runs daily at 03:00 UTC.
- It writes `site-$(date +%Y%m%d).db` via `sqlite3 .backup`, then
  encrypts with `age` against an offline recipient public key, then
  rsyncs the `.age` file to a backup host.
- The age **private key** lives on the operator's hardware key
  (Yubikey age plugin) — never on the VPS.
- The backup host is in a different cloud / region from the VPS.

If both the VPS and the backup host are gone simultaneously, the
recovery target is the operator's offline cold backup (monthly
snapshot to an air-gapped drive).

---

## Recovery procedure

### Step 1 — Provision a fresh VPS

Same OS / specs as the original (Ubuntu 24.04 LTS, ≥ 2 vCPU, ≥ 4
GB RAM, ≥ 40 GB SSD). Follow
[`vps-bootstrap-site-vizzor.md`](./vps-bootstrap-site-vizzor.md)
through the docker + compose + nginx + certbot steps, then return
here BEFORE running the application stack.

### Step 2 — Apply VPS hardening

Run [`../security/vps-hardening.md`](../security/vps-hardening.md)
end to end. Don't skip ufw + fail2ban + sshd config — a freshly
restored DB should never be exposed via a weaker host than the
original.

### Step 3 — Pull the latest encrypted backup

```bash
# From the operator workstation:
rsync -av backup-host:/srv/vizzor-backups/site-$(date -d 'yesterday' +%Y%m%d).db.age \
  ./site-restore.db.age
```

### Step 4 — Decrypt with the hardware key

```bash
# The age-plugin-yubikey identity is the only decryption path.
age --decrypt --identity ~/.age/identities.txt \
  -o site-restore.db site-restore.db.age
sha256sum site-restore.db
# Compare against the digest from the night the backup was taken
# (logged by vizzor-db-backup.sh into syslog).
```

### Step 5 — Stage the DB on the new VPS

```bash
scp site-restore.db deploy@new-vps:/tmp/site-restore.db
ssh deploy@new-vps "
  sudo mkdir -p /var/lib/docker/volumes/site-vizzor-db/_data
  sudo cp /tmp/site-restore.db /var/lib/docker/volumes/site-vizzor-db/_data/site.db
  sudo chown root:root /var/lib/docker/volumes/site-vizzor-db/_data/site.db
  sudo chmod 0600 /var/lib/docker/volumes/site-vizzor-db/_data/site.db
  rm /tmp/site-restore.db
"
```

### Step 6 — Restore secrets

Re-provision `/opt/7aylabs/.env` and `/opt/7aylabs/secrets/*.json`
from the offline secret store (1Password / age-encrypted manifest
on the operator's hardware key). The pool JSON file MUST match
the `VIZZOR_SOLANA_POOL_SHA256` recorded in the `.env`.

```bash
ssh deploy@new-vps "
  sudo install -m 0600 -o deploy -g deploy /tmp/env.staged /opt/7aylabs/.env
  sudo install -m 0400 -o root  -g root  /tmp/sol-pool.json.staged /opt/7aylabs/secrets/sol-pool.json
  sudo sha256sum /opt/7aylabs/secrets/sol-pool.json
"
# verify the sha256 matches VIZZOR_SOLANA_POOL_SHA256
```

### Step 7 — Bring the stack up

```bash
ssh deploy@new-vps "cd /opt/7aylabs && sudo docker compose pull && sudo docker compose up -d"
```

### Step 8 — Verify health

```bash
curl -s https://app.vizzor.ai/api/health | jq '.'
# .status == "ok"
# .subsystems.solanaWatcher.lastTickAt = non-null
# .subsystems.sanctionsFeed.ok = true
# .subsystems.addressPool.ok = true
```

### Step 9 — Verify audit-log + sub continuity

The restored DB must show the prior subscriptions:

```bash
ssh deploy@new-vps "sudo docker exec site-vizzor sqlite3 /app/.vizzor/site.db \
  'SELECT COUNT(*) AS active_subs FROM subscriptions WHERE expires_at IS NULL OR expires_at > strftime(\"%s\",\"now\")*1000;'"
```

### Step 10 — DNS cutover

Update the A record for `app.vizzor.ai` (and `api.` if the engine
co-deployed) to the new VPS's IP. TTL on the production zone is
5 min — full propagation within 10 min.

### Step 11 — Re-baseline the backup pipeline

```bash
ssh deploy@new-vps "sudo /usr/local/bin/vizzor-db-backup.sh"
ssh backup-host "ls -la /srv/vizzor-backups/ | tail -3"
# Fresh .age file for today's date.
```

---

## Post-recovery review

Within 24 h of recovery:

- Open a written incident report. Include the loss cause, restore
  timeline, RPO actuals, and any in-flight sessions that hit
  manual reconciliation.
- If the loss cause was security (compromise), rotate **every**
  secret: bot tokens, RPC keys, age recipient. Update the offline
  secret store. Re-record the pool sha256.
- Run the [`mainnet-flip-checklist.md`](./mainnet-flip-checklist.md)
  preflight section against the new VPS — confirms no regressions
  from the rebuild.

---

## Restore drill (quarterly)

Run this procedure end-to-end against a throwaway staging VM at
least once per quarter. Time the restore; if RTO drifts above 2 h,
investigate (most likely cause: missing pool integrity step or
DNS TTL).
