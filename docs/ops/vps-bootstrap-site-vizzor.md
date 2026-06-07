# site-vizzor — first-time VPS bootstrap

Greenfield install of both production and staging on the existing
`159.198.70.125` VPS that already runs the engine stack (`/home/deploy/vizzor`)
and a mailserver. nginx + certbot are present; Caddy is **not**.

End state after this runbook:

| URL                      | Container               | Port (loopback) | Cert       | Solana network |
|--------------------------|-------------------------|-----------------|------------|----------------|
| `https://vizzor.ai`      | `site-vizzor`           | `127.0.0.1:7120`| Let's Encrypt | mainnet       |
| `https://www.vizzor.ai`  | `site-vizzor` (alias)   | `127.0.0.1:7120`| same cert  | mainnet       |
| `https://test.vizzor.ai` | `site-vizzor-staging`   | `127.0.0.1:7121`| Let's Encrypt | devnet        |

The compose stack lives at `/opt/7aylabs/` (deliberately separate from the
existing engine stack at `/home/deploy/vizzor`).

## Pre-flight (do once, total ≤ 2 min)

- [ ] DNS resolves: `dig vizzor.ai +short` and `dig test.vizzor.ai +short` both return `159.198.70.125`
- [ ] Cloudflare proxy status is **DNS only** (gray cloud) for both, otherwise certbot HTTP-01 will fail
- [ ] Port 80 inbound is reachable from the public internet: `nc -vz vizzor.ai 80` from your laptop
- [ ] `ghcr.io/7aylabs/site-vizzor:latest` and `:testing` exist in GHCR (the deploy workflow has run at least once for both branches)
- [ ] You have a GitHub PAT with `read:packages` for pulling the images on the VPS

## 1. Create the directory + Docker network

```bash
sudo mkdir -p /opt/7aylabs
sudo chown root:root /opt/7aylabs

# External network — both prod and staging services attach to it, so
# any sidecar (Sentry agent, log shipper) can reach both without
# special wiring.
docker network create 7aylabs_net 2>/dev/null || true

# Webroot for certbot HTTP-01 challenges.
sudo mkdir -p /var/www/letsencrypt
sudo chown -R www-data:www-data /var/www/letsencrypt
```

## 2. Install the nginx config

The canonical configs live in this repo at:

- `docs/ops/nginx-site-vizzor.conf`
- `docs/ops/nginx-site-vizzor-proxy-common.conf`

Copy them onto the VPS:

```bash
# From your laptop:
scp -P 2222 \
  docs/ops/nginx-site-vizzor.conf \
  root@159.198.70.125:/etc/nginx/sites-available/site-vizzor.conf

scp -P 2222 \
  docs/ops/nginx-site-vizzor-proxy-common.conf \
  root@159.198.70.125:/etc/nginx/snippets/site-vizzor-proxy-common.conf
```

Or render them on the VPS directly from the repo if you've git-cloned it there.

Enable the site + validate + reload:

```bash
# On the VPS:
sudo mkdir -p /etc/nginx/snippets

sudo ln -sf /etc/nginx/sites-available/site-vizzor.conf \
            /etc/nginx/sites-enabled/site-vizzor.conf

sudo nginx -t                # validate; must say "syntax is ok"
sudo systemctl reload nginx
```

At this point `http://vizzor.ai/` and `http://test.vizzor.ai/` should
proxy to nothing (containers not up yet) and return a `502`. That's
expected — we just need port 80 reachable for the next step.

## 3. Issue Let's Encrypt certs for all three domains

```bash
sudo certbot --nginx \
  -d vizzor.ai \
  -d www.vizzor.ai \
  -d test.vizzor.ai \
  --agree-tos \
  --email security@vizzor.ai \
  --redirect \
  --no-eff-email
```

certbot will:

1. Validate each domain via HTTP-01 challenge over port 80.
2. Issue a single multi-SAN cert covering all three.
3. Edit `site-vizzor.conf` in-place to add the `listen 443 ssl` block, the cert paths, and the `80 -> 443` redirects.
4. Reload nginx.

Verify:

```bash
sudo certbot certificates | grep -A 3 vizzor.ai
curl -sI https://vizzor.ai/      | head -1   # 502 (container not up yet)
curl -sI https://test.vizzor.ai/ | head -1   # 502 (container not up yet)
```

A `502` here is success — TLS handshake completed, the request reached nginx, nginx tried to proxy to the (non-existent) container.

## 4. Render the env files from 1Password

The two env files differ only in the seven variables listed at the top of `.env.example` (search "Staging override summary").

### 4.1 1Password vault items

Create two items in the `7aylabs` vault (replace vault name if different):

```bash
# Production — site-vizzor (mainnet, real treasury)
op item create --vault 7aylabs --category="Secure Note" \
  --title="site-vizzor" \
  "solana-mainnet-rpc[password]=<helius-or-triton-mainnet-url>" \
  "solana-mainnet-treasury[password]=<prod-treasury-pubkey>" \
  "bot-shared-secret[password]=$(openssl rand -base64 32 | tr -d '/+=' | head -c 43)" \
  "rate-limit-salt[password]=$(openssl rand -base64 32 | tr -d '/+=' | head -c 43)" \
  "telegram-bot-username[text]=vizzorai_bot"

# Staging — site-vizzor-staging (devnet, test treasury)
op item create --vault 7aylabs --category="Secure Note" \
  --title="site-vizzor-staging" \
  "solana-devnet-rpc[password]=https://api.devnet.solana.com" \
  "solana-devnet-treasury[password]=<devnet-treasury-pubkey>" \
  "bot-shared-secret[password]=$(openssl rand -base64 32 | tr -d '/+=' | head -c 43)" \
  "rate-limit-salt[password]=$(openssl rand -base64 32 | tr -d '/+=' | head -c 43)" \
  "telegram-bot-username[text]=vizzorai_test_bot"
```

### 4.2 Templates

Create `/opt/7aylabs/.env.template` (production) and `/opt/7aylabs/.env.staging.template` (staging). The staging block is in §Step 4 of `analize-te-contet-logic-crispy-reef.md`; the prod block is the same with the staging-only overrides flipped to mainnet values.

### 4.3 Render

```bash
op inject -i /opt/7aylabs/.env.template         -o /opt/7aylabs/.env
op inject -i /opt/7aylabs/.env.staging.template -o /opt/7aylabs/.env.staging
sudo chmod 600 /opt/7aylabs/.env /opt/7aylabs/.env.staging
```

### 4.4 Validate

```bash
# Neither file should contain unresolved {{ op:// }} placeholders.
grep -c '{{' /opt/7aylabs/.env          # → 0
grep -c '{{' /opt/7aylabs/.env.staging  # → 0
```

## 5. Ship the docker-compose files

Two files need to live at `/opt/7aylabs/`:

- `docker-compose.yml`        — base file declaring the `7aylabs_net` external network
- `docker-compose.prod.yml`   — prod overlay (block in `docs/ops/site-vizzor-compose-snippet.yml`)
- `docker-compose.staging.yml`— staging overlay (block in `docs/ops/site-vizzor-staging-compose-snippet.yml`)

Minimal `docker-compose.yml`:

```yaml
networks:
  7aylabs_net:
    external: true

# Service blocks are defined entirely in the overlays so this base
# stays env-agnostic. To add another service later (sidecar, log
# shipper) declare it here.
services: {}
```

Copy all three from the repo:

```bash
# From your laptop:
scp -P 2222 \
  docs/ops/site-vizzor-compose-snippet.yml \
  root@159.198.70.125:/tmp/site-vizzor-compose-snippet.yml

scp -P 2222 \
  docs/ops/site-vizzor-staging-compose-snippet.yml \
  root@159.198.70.125:/tmp/site-vizzor-staging-compose-snippet.yml
```

On the VPS, extract the `services:` + `volumes:` blocks from each snippet (everything below the leading comment header) into:

- `/opt/7aylabs/docker-compose.prod.yml`
- `/opt/7aylabs/docker-compose.staging.yml`

And create the base file:

```bash
sudo tee /opt/7aylabs/docker-compose.yml > /dev/null <<'YAML'
networks:
  7aylabs_net:
    external: true
services: {}
YAML
```

Validate:

```bash
cd /opt/7aylabs
docker compose -f docker-compose.yml -f docker-compose.prod.yml    config | head -30
docker compose -f docker-compose.yml -f docker-compose.staging.yml config | head -30
```

Both should render without errors and show the right env_file paths, the right ports (7120 / 7121), and the right named volumes.

## 6. Log into GHCR and pull both images

```bash
echo "<github-pat-with-read-packages>" | docker login ghcr.io -u <github-user> --password-stdin

docker pull ghcr.io/7aylabs/site-vizzor:latest
docker pull ghcr.io/7aylabs/site-vizzor:testing
```

If `:latest` or `:testing` is missing, trigger the deploy workflow manually for each branch from your laptop:

```bash
gh workflow run deploy.yml --ref main
gh workflow run deploy.yml --ref testing
gh run watch
```

(The workflow's deploy step will fail on the SSH part because the compose stack isn't fully wired yet, but the build + push step will have completed by then — that's the only part you need from the first run.)

## 7. First-time bring-up

```bash
cd /opt/7aylabs

# Production
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  up -d site-vizzor

# Staging
docker compose -f docker-compose.yml -f docker-compose.staging.yml \
  up -d site-vizzor-staging
```

Watch both come up:

```bash
docker logs -f --tail=50 site-vizzor          # Ctrl-C when ready
docker logs -f --tail=50 site-vizzor-staging  # Ctrl-C when ready
```

Each should log `Listening on http://0.0.0.0:3000` within 5 seconds.

## 8. End-to-end verification

From your laptop:

```bash
# Both URLs reach their containers
curl -sI https://vizzor.ai/      | head -1   # HTTP/2 200
curl -sI https://test.vizzor.ai/ | head -1   # HTTP/2 200

# Health subsystems healthy
curl -s https://vizzor.ai/api/health      | jq '.status, .subsystems'
curl -s https://test.vizzor.ai/api/health | jq '.status, .subsystems'

# Different volumes, different containers, different DBs
ssh -p 2222 root@159.198.70.125 'docker volume ls | grep site-vizzor'
# → site-vizzor-db
# → site-vizzor-staging-db
```

## 9. First automated deploy

Push (or merge a PR) to the `testing` branch. The workflow at `.github/workflows/deploy.yml` will:

1. `resolve` job emits `target=staging`, `image_tag=testing`, etc.
2. `build-and-push` rebuilds `:testing` with `NEXT_PUBLIC_VIZZOR_API_URL=https://api.vizzor.ai`.
3. `deploy-vps` SSHes in, runs `docker compose -f docker-compose.yml -f docker-compose.staging.yml pull site-vizzor-staging` and `up -d --force-recreate`.
4. Smoke test polls `https://test.vizzor.ai/api/health` and asserts the subsystems map is healthy.

A merge to `main` does the same with `target=prod`, `image_tag=latest`, `service_name=site-vizzor`, hitting `https://vizzor.ai/api/health`.

## Rollback

Every deploy tags the image with both the env tag (`:latest` / `:testing`) and an immutable `<branch>-<sha>` tag. To roll back:

```bash
cd /opt/7aylabs

# Find the previous immutable tag
docker images ghcr.io/7aylabs/site-vizzor --format '{{.Tag}} {{.CreatedAt}}' | head -5

# Pin the prod compose to that tag temporarily
sed -i 's|site-vizzor:latest|site-vizzor:main-<sha>|' docker-compose.prod.yml
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate site-vizzor

# After the regression is fixed and re-pushed to main, revert the sed.
```

## Failure modes + fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| certbot says "Detail: Fetching http://... Connection refused" | Port 80 not reachable from public internet | Check `sudo ufw status` and any cloud firewall; certbot needs port 80 |
| `curl -sI https://vizzor.ai/` returns blank | nginx didn't get the cert (certbot reverted on error) | Re-run certbot with `--debug-challenges`, fix the underlying issue, re-run |
| Container starts but `/api/health` returns `subsystems.watcher.ok: false` | Mainnet RPC unset or invalid | Inspect `/opt/7aylabs/.env` — `SOLANA_RPC_URL_MAINNET` must be a private RPC in prod |
| Staging container won't pull | GHCR auth expired | Re-run `docker login ghcr.io` with a fresh PAT |
| nginx -t fails with "host not found in upstream" | typo in the upstream block names | Re-check `site-vizzor.conf`; the upstream names must match exactly |

## Adjacent docs

- `docs/ops/secrets.md` — 1Password integration deep dive
- `docs/ops/runbook-security-incident.md` — what to do if a prod incident happens
- `docs/ops/site-vizzor-compose-snippet.yml` — canonical prod compose block
- `docs/ops/site-vizzor-staging-compose-snippet.yml` — canonical staging compose block
- `BRANCHING.md` §10 — branch → environment mapping
