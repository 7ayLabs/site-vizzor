# syntax=docker/dockerfile:1.7

# ──────────────────────────────────────────────────────────────────────
# Base — pnpm + node 20
# ──────────────────────────────────────────────────────────────────────
FROM node:26-alpine@sha256:725aeba2364a9b16beae49e180d83bd597dbd0b15c47f1f28875c290bfd255b9 AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# ──────────────────────────────────────────────────────────────────────
# Dependencies — install only (deterministic, cacheable)
# ──────────────────────────────────────────────────────────────────────
FROM base AS deps
# Native-build toolchain for `better-sqlite3` (load-bearing — the site's
# entire payment state lives in it) and a few wallet-adapter peer
# native modules. Alpine ships none of these by default, so without
# them `pnpm install` fails the deps stage on `node-gyp rebuild`.
# These layers stay in the deps stage only; the final runner image
# uses Next.js' standalone bundle and never sees node-gyp.
RUN apk add --no-cache python3 make g++ libc-dev linux-headers eudev-dev
COPY package.json pnpm-lock.yaml .npmrc ./
# fumadocs-mdx runs as a postinstall hook and hashes source.config.ts —
# the deps stage has no source tree, so without this copy the install
# throws "Cannot find config file". The file is self-contained (only
# imports from npm packages) so this doesn't bust the layer cache
# unless the MDX config itself changes.
COPY source.config.ts ./
RUN pnpm install --frozen-lockfile --prefer-offline

# ──────────────────────────────────────────────────────────────────────
# Build — produce Next.js standalone output
# ──────────────────────────────────────────────────────────────────────
FROM base AS build
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build-time SHA + build time embedded for /api/health
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ENV GIT_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME

# Public env vars must be present at build time so they're inlined
ARG NEXT_PUBLIC_VIZZOR_API_URL=https://api.vizzor.ai
ENV NEXT_PUBLIC_VIZZOR_API_URL=$NEXT_PUBLIC_VIZZOR_API_URL

# Chain selector — baked at build because client components read it via
# `paymentNetwork()` (lib/payment/network.ts). The deploy workflow
# passes `devnet` for the `testing` branch (test.vizzor.ai) and
# `mainnet` for `main` (vizzor.ai). Default `mainnet` keeps unrelated
# local builds from accidentally shipping a staging chain.
ARG NEXT_PUBLIC_PAYMENT_NETWORK=mainnet
ENV NEXT_PUBLIC_PAYMENT_NETWORK=$NEXT_PUBLIC_PAYMENT_NETWORK

# Dev-auth bypass — baked at build because the wallet-connect cascade
# reads it client-side to decide whether to silently mint a session
# via `/api/auth/dev-sign` when Phantom rejects post-confirm with the
# generic "Unexpected error" (the documented localhost+Devnet multi-
# chain Phantom bug). Without this, the `testing` build ships a dead
# `process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH === 'true'` check that
# always evaluates false at runtime — there's nothing to read in the
# client bundle. Default empty so unrelated builds (prod) don't
# accidentally inherit the bypass.
ARG NEXT_PUBLIC_ALLOW_DEV_AUTH=
ENV NEXT_PUBLIC_ALLOW_DEV_AUTH=$NEXT_PUBLIC_ALLOW_DEV_AUTH

# Crypto checkout gate — baked at build because the client-side
# `CheckoutShell` (components/pay/checkout-shell.tsx) consults
# `acceptSolanaPayments()` to decide between the working Activate-Pro
# flow and the "infrastructure pending" fallback panel. Without this
# arg the bundle ships a dead `process.env.NEXT_PUBLIC_ACCEPT_SOLANA_PAYMENTS
# === 'true'` check that always evaluates false at runtime — there's
# nothing to read in the client bundle. Default empty so unrelated
# builds (and prod, until the mainnet treasury + watcher have been
# validated end-to-end) don't accidentally inherit the open gate.
ARG NEXT_PUBLIC_ACCEPT_SOLANA_PAYMENTS=
ENV NEXT_PUBLIC_ACCEPT_SOLANA_PAYMENTS=$NEXT_PUBLIC_ACCEPT_SOLANA_PAYMENTS

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm build

# ──────────────────────────────────────────────────────────────────────
# Runner — minimal runtime image with the standalone bundle
# ──────────────────────────────────────────────────────────────────────
FROM node:26-alpine@sha256:725aeba2364a9b16beae49e180d83bd597dbd0b15c47f1f28875c290bfd255b9 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

# Standalone output bundles only the strictly necessary node_modules
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Pre-create the SQLite mount point with non-root ownership. The compose
# named volume (site-vizzor-db / site-vizzor-staging-db) mounts at
# /app/.vizzor; if the dir doesn't exist in the image, Docker creates it
# as root:root and the nextjs user can't write the WAL files.
RUN mkdir -p /app/.vizzor && chown -R nextjs:nodejs /app/.vizzor

USER nextjs
EXPOSE 3000

# Healthcheck — uses the public /api/health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
