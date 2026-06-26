# Rollback — Image SHA Pinning

_Operator-facing. Sub-5-minute revert procedure. Pair with
[`mainnet-flip-checklist.md`](./mainnet-flip-checklist.md) — its
"Abort criteria" section enumerates the conditions that trigger
this document._

This document covers the **bad release** scenario: a deploy lands
on `main`, the VPS pulls the new image, and something is wrong —
a 5xx burst, a watcher stall, a payment flow that won't confirm.
We need to flip back to the previous known-good image in under 5
minutes without losing in-flight data.

The site state (SQLite) survives the image swap because it lives
on a bind-mounted Docker volume (`site-vizzor-db`). Rolling back
an image never rolls back state.

---

## How image-SHA pinning works

`/opt/7aylabs/docker-compose.prod.yml` does not pin to
`ghcr.io/7aylabs/site-vizzor:latest` directly. Instead:

```yaml
services:
  site-vizzor:
    image: ghcr.io/7aylabs/site-vizzor:${IMAGE_TAG:-latest}
    # ...
```

`IMAGE_TAG` is supplied by the deploy workflow at deploy time and
recorded in `/opt/7aylabs/.deploy-log` so the operator can read
the previous good tag without GitHub access.

GHCR retains every per-commit image tag (`sha-<short>`) for 90
days. The previous green tag is always one `grep` away.

---

## Recipe — revert site-vizzor

### Step 1 — Identify the previous good SHA

```bash
ssh deploy@vps "cat /opt/7aylabs/.deploy-log | tail -10"
# Lines look like:
#   2026-06-26T14:02:11Z tag=sha-9792f16 commit=9792f16 status=ok
#   2026-06-26T18:51:33Z tag=sha-8e52a08 commit=8e52a08 status=ok   <-- current
# The line ABOVE "current" is the previous good tag.
```

Alternative — from GitHub:

```bash
gh api repos/7ayLabs/site-vizzor/commits/main --jq '.parents[0].sha' | cut -c1-7
# That short SHA is the previous merge to main; tag is sha-<short>.
```

### Step 2 — Re-deploy with that tag

```bash
ssh deploy@vps "
  cd /opt/7aylabs
  IMAGE_TAG=sha-9792f16 sudo docker compose pull site-vizzor
  IMAGE_TAG=sha-9792f16 sudo docker compose up -d --force-recreate site-vizzor
"
```

The `IMAGE_TAG=...` prefix on the same line is load-bearing — it
makes the compose substitution use the rollback tag for THIS
command without modifying any file. The bind-mounted volume +
the `.env` carry forward unchanged.

### Step 3 — Verify health within 60 s

```bash
curl -s https://app.vizzor.ai/api/health | jq '.status'
# "ok"

ssh deploy@vps "sudo docker compose ps site-vizzor"
# state: Up (healthy)
```

### Step 4 — Confirm the running image matches your rollback tag

```bash
ssh deploy@vps "sudo docker inspect --format '{{.Config.Image}}' site-vizzor"
# expect: ghcr.io/7aylabs/site-vizzor:sha-9792f16
```

### Step 5 — Open a "revert PR" so main reflects reality

If the rollback is going to live for more than an hour, push a
revert PR against `main` so the next normal deploy doesn't
silently re-pull the broken image. Skip this step only if you're
actively about to land a forward fix.

```bash
gh pr create --title "revert: rollback to <SHA> while investigating <symptom>" \
  --body "Rolled back via image-SHA pin. Forward fix tracked in #<issue>."
```

---

## Recipe — revert vizzor engine

Same pattern, different image name + repo path.

```bash
ssh deploy@vps "cat /opt/7aylabs/.deploy-log.engine | tail -10"
# pick the previous good tag, then:
ssh deploy@vps "
  cd /opt/7aylabs
  IMAGE_TAG_ENGINE=sha-<short> sudo docker compose up -d --force-recreate vizzor-engine
"
```

The engine compose service should reference `${IMAGE_TAG_ENGINE}`
to keep the rollback variable independent of the site's tag.

---

## What if pulling the previous tag fails?

GHCR pruning, network blip, or registry outage:

1. The previous image is almost certainly **still on the VPS**
   (Docker keeps the last few images until `docker image prune`
   runs). List local images:
   ```bash
   ssh deploy@vps "sudo docker image ls ghcr.io/7aylabs/site-vizzor"
   ```
2. Tag the local previous image as the rollback target and re-up:
   ```bash
   ssh deploy@vps "sudo docker tag ghcr.io/7aylabs/site-vizzor:sha-9792f16 ghcr.io/7aylabs/site-vizzor:rollback"
   IMAGE_TAG=rollback sudo docker compose up -d --force-recreate site-vizzor
   ```
3. If even local pruning lost it, restore from the off-host backup
   (see [`disaster-recovery.md`](./disaster-recovery.md)) and rebuild
   from source against the previous commit:
   ```bash
   git clone https://github.com/7ayLabs/site-vizzor && cd site-vizzor
   git checkout <previous-commit-sha>
   docker build -t ghcr.io/7aylabs/site-vizzor:rollback-local .
   docker save | ssh deploy@vps "sudo docker load"
   ```

---

## Data migrations and rollback safety

The v0.4.0 SQLite migrations are **additive only** (per `lib/payment/
db.ts::init`): new columns nullable, new tables unreferenced by
older code. A rollback to a v0.3.x image never reads the new
columns, never errors on the new tables, and never modifies them.

If a future release ships a non-additive migration (column
rename, type change), this rollback procedure no longer applies
unchanged. That release MUST land its own dedicated rollback
runbook in this directory before merging.

---

## Post-rollback follow-up

- Annotate the GHCR tag of the bad release with a note (`gh release
  edit <tag> --notes "ROLLED BACK at <UTC time> — see <issue>"`)
  so a future operator never auto-picks it from the green list.
- Open an incident issue tagged `release-incident`. Include the
  symptom, the rollback timeline, the bad commit SHA, and the
  forward-fix plan.
- Run the [`mainnet-flip-checklist.md`](./mainnet-flip-checklist.md)
  preflight before redeploying the forward fix.
