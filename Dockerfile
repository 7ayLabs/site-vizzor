# syntax=docker/dockerfile:1.7

# ──────────────────────────────────────────────────────────────────────
# Base — pnpm + node 20
# ──────────────────────────────────────────────────────────────────────
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# ──────────────────────────────────────────────────────────────────────
# Dependencies — install only (deterministic, cacheable)
# ──────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml .npmrc ./
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

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm build

# ──────────────────────────────────────────────────────────────────────
# Runner — minimal runtime image with the standalone bundle
# ──────────────────────────────────────────────────────────────────────
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runner
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

USER nextjs
EXPOSE 3000

# Healthcheck — uses the public /api/health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
