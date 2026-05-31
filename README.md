<p align="center">
  <img alt="Vizzor" src="https://github.com/7ayLabs/vizzor/raw/main/vizzor_logodarkicon.png" width="96">
</p>

<h1 align="center">vizzor.ai</h1>

<p align="center">
  <strong>Predictions with receipts.</strong><br>
  <em>Marketing + Docs site for Vizzor — Next.js 15 + Tailwind v4 + Fumadocs.</em>
</p>

---

## Quickstart

```bash
pnpm install
pnpm dev               # http://localhost:3000
pnpm typecheck
pnpm lint
pnpm build && pnpm start
```

## Stack

- **Next.js 15** · App Router · React 19 · TypeScript strict
- **Tailwind CSS v4** with token-driven design system
- **Fumadocs** for the `/docs` zone
- **Self-hosted fonts** — Inter + JetBrains Mono variable
- **Live data** from `api.vizzor.ai` (build-time snapshot fallback)

## Deployment

Containerized via `Dockerfile` (Next.js standalone output). Deployed to the 7ayLabs VPS at port `7120`, reverse-proxied by Caddy at `vizzor.ai`. CI/CD in `.github/workflows/`.

## License

[BUSL-1.1](LICENSE) — Business Source License 1.1

---

<p align="center">Built by <a href="https://7aylabs.com">7ayLabs</a></p>
