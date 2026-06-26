# VPS Hardening — site-vizzor production host

_Operator-facing. Run end-to-end on a fresh VPS before bringing the
application stack up. Re-audit quarterly. Pair with
[`../ops/vps-bootstrap-site-vizzor.md`](../ops/vps-bootstrap-site-vizzor.md)
(green-field bootstrap) and
[`../ops/disaster-recovery.md`](../ops/disaster-recovery.md) (VPS
lost scenario)._

The site VPS is a single-host deployment carrying money-touching
state (SQLite-backed subscriptions + watch-only treasury pointers).
The threat model assumes:

- Internet-facing attackers probing for SSH brute-force, web
  vulnerabilities, and exposed admin endpoints.
- A compromised CI / GHCR credential could push a malicious image
  — defense lives at image-SHA pinning + read-only secret mounts.
- A leaked SSH key — defense lives at key-only auth + sshd jail.

OUT of scope here: privileged Docker escape, kernel zero-days,
hypervisor escape. Those map to the disaster-recovery procedure.

---

## 1. Firewall — ufw

Only three ports open inbound:

| Port | Purpose |
|---|---|
| 2222 | SSH (custom; the default 22 closed to drop scanner noise) |
| 80   | HTTP (Let's Encrypt ACME challenge + redirect to 443) |
| 443  | HTTPS (nginx → site-vizzor + engine reverse proxy) |

```bash
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 2222/tcp comment "ssh custom port"
sudo ufw allow 80/tcp   comment "http (le acme + redirect)"
sudo ufw allow 443/tcp  comment "https"
sudo ufw --force enable
sudo ufw status verbose
```

All Docker container ports MUST bind to `127.0.0.1` in the compose
file (nginx is the only public listener). Verify:

```bash
sudo ss -tlnp | grep -v 127.0.0.1 | grep -v "^State"
# Only sshd:2222, nginx:80, nginx:443 should appear on a non-loopback address.
```

Audit:

```bash
sudo ufw status numbered
```

Re-run `ufw status verbose` quarterly and after every compose change.

---

## 2. fail2ban — sshd brute-force shield

Install + enable, with an aggressive sshd jail.

```bash
sudo apt-get install -y fail2ban
sudo install -m 0644 /dev/stdin /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 24h
findtime = 10m
maxretry = 4
banaction = iptables-multiport
backend   = systemd

[sshd]
enabled  = true
port     = 2222
mode     = aggressive
EOF
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

Audit:

```bash
sudo fail2ban-client status sshd
# expect: "Status for the jail: sshd" + a recent banned-IP count
```

If the jail status shows no activity for > 30 days, the
log path probably broke (rsyslog vs. systemd-journal). Re-verify
with `journalctl -u ssh -n 100`.

---

## 3. sshd — key-only, custom port

Edit `/etc/ssh/sshd_config` (or `/etc/ssh/sshd_config.d/00-hardening.conf`):

```conf
Port 2222
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
UsePAM yes
AuthenticationMethods publickey
PubkeyAuthentication yes
AllowUsers deploy
MaxAuthTries 3
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
PermitTunnel no
GatewayPorts no
PrintMotd no
```

Then:

```bash
sudo sshd -t && sudo systemctl restart ssh
ss -tlnp | grep :2222
```

Audit:

```bash
sudo sshd -T | grep -iE 'passwordauthentication|permitrootlogin|port|allowusers'
# expect:
#   passwordauthentication no
#   permitrootlogin no
#   port 2222
#   allowusers deploy
```

---

## 4. File permissions — secrets at rest

The runtime needs to read these files, no one else does.

| Path | Mode | Owner | Notes |
|---|---|---|---|
| `/opt/7aylabs/.env` | `0600` | `deploy:deploy` | bot tokens, RPC URLs |
| `/opt/7aylabs/.env.staging` | `0600` | `deploy:deploy` | staging variant |
| `/opt/7aylabs/secrets/sol-pool.json` | `0400` | `root:root` | bind-mounted `:ro` |
| `/opt/7aylabs/secrets/ton-pool.json` | `0400` | `root:root` | bind-mounted `:ro` |
| `/var/lib/docker/volumes/site-vizzor-db/_data/site.db` | `0600` | `root:root` | SQLite payment state |
| `/opt/7aylabs/backups/*.age` | `0400` | `root:root` | encrypted backups |

Apply:

```bash
sudo install -m 0600 -o deploy -g deploy /tmp/env.staged /opt/7aylabs/.env
sudo install -m 0400 -o root  -g root  /tmp/sol-pool.json /opt/7aylabs/secrets/sol-pool.json
sudo install -m 0400 -o root  -g root  /tmp/ton-pool.json /opt/7aylabs/secrets/ton-pool.json
sudo chmod 0600 /var/lib/docker/volumes/site-vizzor-db/_data/site.db
sudo chown root:root /var/lib/docker/volumes/site-vizzor-db/_data/site.db
sudo chmod 0700 /opt/7aylabs/backups
```

Audit:

```bash
sudo find /opt/7aylabs/secrets /opt/7aylabs/.env* /opt/7aylabs/backups \
  -type f -printf '%m %u:%g %p\n'
```

The application also runs a **boot-time audit** that re-verifies
the pool file mode (per `lib/payment/audit.ts`); a 0644 pool file
refuses container startup. That gate is the last-line defense in
case a hot-fix `chmod` accidentally exposes a secret.

---

## 5. Encrypted nightly backup — age + rsync

### 5.1 Script

```bash
sudo install -m 0755 /dev/stdin /usr/local/bin/vizzor-db-backup.sh <<'EOF'
#!/usr/bin/env bash
# Nightly site.db backup, encrypted with age to an offline recipient,
# rsynced to a separate host. Never logs the recipient pubkey content;
# the recipient is read from /etc/vizzor-backup-recipient (mode 0400 root).
set -euo pipefail
TS=$(date -u +%Y%m%d)
SRC=/var/lib/docker/volumes/site-vizzor-db/_data/site.db
DST_LOCAL=/opt/7aylabs/backups/site-${TS}.db
DST_ENC=${DST_LOCAL}.age
RECIPIENT_FILE=/etc/vizzor-backup-recipient
REMOTE=backup-host:/srv/vizzor-backups/

# 1. Atomic snapshot via .backup so we never copy a half-written WAL.
sqlite3 "$SRC" ".backup '${DST_LOCAL}'"

# 2. sha256 line goes to syslog for the operator's audit trail.
SHA=$(sha256sum "$DST_LOCAL" | awk '{print $1}')
logger -t vizzor-db-backup "snapshot=${DST_LOCAL} sha256=${SHA}"

# 3. Encrypt against the offline recipient.
age -e -R "$RECIPIENT_FILE" -o "$DST_ENC" "$DST_LOCAL"
chmod 0400 "$DST_ENC"
rm -f "$DST_LOCAL"

# 4. Ship to the remote host.
rsync -av --remove-source-files "$DST_ENC" "$REMOTE"

# 5. Prune local stage (rsync removed the file already).
find /opt/7aylabs/backups -name 'site-*.db.age' -mtime +1 -delete
EOF
sudo install -m 0400 -o root -g root /tmp/age-recipient.txt /etc/vizzor-backup-recipient
sudo mkdir -p /opt/7aylabs/backups
sudo chmod 0700 /opt/7aylabs/backups
```

### 5.2 Cron

```bash
sudo install -m 0644 /dev/stdin /etc/cron.d/vizzor-db-backup <<'EOF'
# m h dom mon dow user  command
0 3 * * * root /usr/local/bin/vizzor-db-backup.sh
EOF
```

### 5.3 Audit

```bash
# Manual test
sudo /usr/local/bin/vizzor-db-backup.sh
journalctl -t vizzor-db-backup --since "10 min ago"
ssh backup-host "ls -la /srv/vizzor-backups/ | tail -3"
```

The age recipient **public key** is the only thing on the VPS;
the matching private key lives on the operator's hardware key
(age-plugin-yubikey). Restoration is documented in
[`../ops/disaster-recovery.md`](../ops/disaster-recovery.md).

---

## 6. Docker daemon

- Log rotation already enforced in the compose file
  (`max-size: 10m`, `max-file: 3`). Verify:

  ```bash
  sudo docker inspect site-vizzor --format '{{.HostConfig.LogConfig}}'
  ```

- `userns-remap` is NOT enabled (incompatible with bind-mounting a
  pool file `:ro`). The compose file pins each service to `user:
  deploy:deploy` to compensate.

- `live-restore` enabled so a Docker daemon restart doesn't drop
  the watcher:

  ```bash
  sudo install -m 0644 /dev/stdin /etc/docker/daemon.json <<'EOF'
  {
    "live-restore": true,
    "log-driver": "json-file",
    "log-opts": { "max-size": "10m", "max-file": "3" }
  }
  EOF
  sudo systemctl restart docker
  ```

---

## 7. Unattended security updates

```bash
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

Only **security** pocket auto-applies. Major version upgrades stay
manual so a `do-release-upgrade` never reboots into a different
glibc / kernel without an operator window.

---

## 8. Quarterly audit checklist

Run on the first business day of each quarter:

- [ ] `sudo ufw status verbose` — three rules, no others.
- [ ] `sudo fail2ban-client status sshd` — jail enabled, log path live.
- [ ] `sudo sshd -T | grep -iE 'passwordauth|rootlogin|port|allowusers'`.
- [ ] File-mode audit (Section 4).
- [ ] `sudo /usr/local/bin/vizzor-db-backup.sh` test run.
- [ ] `ssh backup-host "ls -la /srv/vizzor-backups/ | head"` — daily files
      present for the last 30 days.
- [ ] Restore drill on a throwaway staging VM (per disaster-recovery.md).
- [ ] Rotate the bot shared secret per the incident runbook's rotation flow.

Record completion in `/opt/7aylabs/.audit-log`:

```bash
echo "$(date -uIs) vps-hardening audit complete by $USER" \
  | sudo tee -a /opt/7aylabs/.audit-log
```
