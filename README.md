<p align="center">
  <img alt="Vizzor" src="https://github.com/7ayLabs/vizzor/raw/main/vizzor_logodarkicon.png" width="96">
</p>

<h1 align="center">vizzor.ai</h1>

<p align="center">
  <strong>Predictions with receipts.</strong><br>
  <em>Marketing + Docs site for Vizzor.</em>
</p>

---

## Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js 20 · pnpm 9 |
| Framework | Next.js 15 (App Router) · React 19 · TypeScript strict |
| Styling | Tailwind CSS v4 with CSS-variable tokens (light + dark) |
| i18n | `next-intl` (en default, es, fr) |
| Docs | Fumadocs with KaTeX math |
| 3D | Three.js + `@react-three/fiber` + `@react-three/drei` |
| Motion | GSAP + IntersectionObserver-driven reveals |
| Data | SWR client hooks + build-time snapshot fallback |
| Container | Docker (multi-stage, standalone Next output) |
| CI/CD | GitHub Actions → GHCR → VPS via SSH |

## Quickstart (local)

```bash
pnpm install
pnpm dev               # http://localhost:3000
pnpm typecheck
pnpm build && pnpm start
```

Locales served at `/` (en), `/es`, `/fr`. Docs at `/docs` (English-only for v0.1.0). The internal QA route `/dev/components` is dev-only and 404s in production.

## Live data layer

The site shows live predictions and tracked WR pulled from `api.vizzor.ai`. The contract:

```
GET /v1/site/ticker                 → TickerEntry[]
GET /v1/site/tracker-wr             → TrackerWR
GET /v1/site/last-24h               → Last24h
GET /v1/site/recent-predictions     → Prediction[]
GET /v1/site/prediction/:id         → Prediction
```

When the API is unreachable, every hook in `lib/api.ts` transparently falls back to `data/snapshot.json` (committed to the repo, refreshed hourly by `.github/workflows/snapshot.yml`).

Configure the API base via env var: `NEXT_PUBLIC_VIZZOR_API_URL=https://api.vizzor.ai`.

> The `/v1/site/*` endpoints live in the **Vizzor product repo** ([github.com/7ayLabs/vizzor](https://github.com/7ayLabs/vizzor)) and are exposed by the Fastify API on port `7100`. Per operator rules, that side requires a separate PR; the snapshot fallback keeps this site fully functional in the meantime.

## Internal API routes

| Route | Purpose |
|---|---|
| `/api/health` | Public health probe — returns sha, build time, uptime. Used by Docker healthcheck and the deploy workflow's smoke test. |
| `/api/snapshot` | Proxies the live API into the snapshot shape. Called hourly by the snapshot refresh workflow. |
| `/api/search` | Fumadocs Orama-backed docs search. |
| `/changelog/feed.xml` | RSS 2.0 feed for the changelog. |
| `/predictions/[id]/opengraph-image` | Edge-runtime PNG generator for shareable prediction cards (1200×630). |

## Deployment (operator runbook)

### Prerequisites
- VPS reachable via SSH
- Docker + Docker Compose installed on VPS
- DNS A records pointing `vizzor.ai` and `api.vizzor.ai` to the VPS IP
- A reverse proxy (Caddy or Nginx) handling TLS and routing

### GitHub Actions secrets

Set these in `7ayLabs/site-vizzor` repository settings → Secrets and variables → Actions:

| Secret | What it's for |
|---|---|
| `VPS_HOST` | Hostname or IP of the VPS |
| `VPS_USER` | SSH user (typically `deploy` or `root`) |
| `VPS_SSH_KEY` | Private key for the deploy user |
| `VPS_PORT` | (optional) SSH port if not 22 |

`GITHUB_TOKEN` is automatically provided by Actions and grants push access to GHCR.

### Compose entry (in the Vizzor product repo's `docker-compose.prod.yml`)

```yaml
services:
  site-vizzor:
    image: ghcr.io/7aylabs/site-vizzor:latest
    container_name: site-vizzor
    restart: always
    environment:
      NODE_ENV: production
      NEXT_PUBLIC_VIZZOR_API_URL: https://api.vizzor.ai
    ports:
      - "127.0.0.1:7120:3000"
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 20s
```

Port `7120` is reserved for site-vizzor in the 71xx block (alongside `7100` vizzor-api, `7110` product dashboard, `7200` chronovisor-engine, `7300` n8n).

### Caddy block

```caddy
vizzor.ai {
  reverse_proxy 127.0.0.1:7120
  encode gzip zstd
}

api.vizzor.ai {
  reverse_proxy 127.0.0.1:7100
  encode gzip zstd
  # CORS for site-vizzor on /v1/site/*
  @site path /v1/site/*
  header @site {
    Access-Control-Allow-Origin "https://vizzor.ai"
    Access-Control-Allow-Methods "GET, OPTIONS"
    Access-Control-Max-Age "86400"
  }
}
```

TLS is automatic via Let's Encrypt. No certbot setup required.

### Deploy flow

`git push origin main` →
1. CI workflow runs (typecheck · lint · test · build)
2. Deploy workflow builds Docker image, pushes to GHCR
3. SSH to VPS, `docker compose pull && up -d` for `site-vizzor` only
4. Smoke test polls `https://vizzor.ai/api/health` until 200

Rollback: bump the `image:` tag in `docker-compose.prod.yml` to a previous `ghcr.io/7aylabs/site-vizzor:<sha>` and `docker compose up -d --force-recreate site-vizzor`.

## Branch strategy

Per operator memory rules:
- `feat/*`, `fix/*`, `hotfix/*` branch from `develop` but **PRs target `main` directly**
- Release branches follow `develop → testing → main`
- Conventional commits with site-specific scopes: `home`, `predictions`, `pricing`, `manifesto`, `changelog`, `docs`, `ui`, `i18n`, `api`, `motion`, `theme`, `seo`, `deploy`, `deps`
- Subject text after the colon **lowercase** (commitlint)
- No `Co-Authored-By` trailer
- No auto-commit, no auto-push without explicit instruction

## License

[BUSL-1.1](https://github.com/7ayLabs/vizzor/blob/main/LICENSE.md) — Business Source License 1.1

---

<p align="center">Built by <a href="https://7aylabs.com">7ayLabs</a></p>
