#!/usr/bin/env bash
#
# build-local-and-up.sh — first-time bring-up that bypasses GHCR.
#
# The deploy workflow at .github/workflows/deploy.yml builds the
# image in GHA, pushes to ghcr.io/7aylabs/site-vizzor:<env-tag>, then
# SSHes to the VPS to docker compose pull + up -d. That's the steady
# state.
#
# This script is the bootstrap variant for the *very first* deploy,
# before either `:latest` or `:testing` has ever been pushed to GHCR.
# It builds the image directly from /srv/site-vizzor, tags it twice
# (latest + testing), and brings up both site-vizzor and
# site-vizzor-staging using the local image instead of pulling.
#
# After this script has run once successfully, every subsequent
# deploy goes through the normal pipeline: merge -> push -> workflow
# -> GHCR -> docker compose pull -> recreate. Re-running this script
# is safe — `docker compose up -d` is idempotent — but it isn't the
# normal path.
#
# Usage:
#   sudo bash /srv/site-vizzor/scripts/build-local-and-up.sh

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: this script must be run as root (use sudo)" >&2
  exit 2
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_DIR="/opt/7aylabs"
IMAGE="ghcr.io/7aylabs/site-vizzor"
GIT_SHA="$(cd "$REPO_DIR" && git rev-parse --short HEAD)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ ! -f "$STACK_DIR/docker-compose.yml" ]]; then
  echo "ERROR: $STACK_DIR/docker-compose.yml not found. Run bootstrap-stack.sh first." >&2
  exit 1
fi

# ─── 1. Build the image with both env tags ──────────────────────────────
# Both prod and staging bake NEXT_PUBLIC_VIZZOR_API_URL=https://api.vizzor.ai
# (the engine is single-tenant), so one image serves both. Two tags
# avoid a docker compose pull failure for either overlay.
echo "▶ Building $IMAGE from $REPO_DIR"
echo "  GIT_SHA=$GIT_SHA"
echo "  BUILD_TIME=$BUILD_TIME"
echo ""
cd "$REPO_DIR"
docker build \
  --tag "$IMAGE:latest" \
  --tag "$IMAGE:testing" \
  --tag "$IMAGE:bootstrap-$GIT_SHA" \
  --build-arg "GIT_SHA=$GIT_SHA" \
  --build-arg "BUILD_TIME=$BUILD_TIME" \
  --build-arg "NEXT_PUBLIC_VIZZOR_API_URL=https://api.vizzor.ai" \
  .

echo ""
echo "▶ Image built. Tags:"
docker images "$IMAGE" --format 'table {{.Tag}}\t{{.CreatedAt}}\t{{.Size}}' | head -5

# ─── 2. Bring up staging ─────────────────────────────────────────────────
cd "$STACK_DIR"

echo ""
echo "▶ Bringing up site-vizzor-staging"
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d site-vizzor-staging

echo ""
echo "▶ Bringing up site-vizzor (prod)"
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d site-vizzor

# ─── 3. Wait briefly and probe ──────────────────────────────────────────
echo ""
echo "▶ Waiting 8s for both containers to settle"
sleep 8

echo ""
echo "── docker ps ──"
docker ps --filter name=site-vizzor --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

echo ""
echo "── health probes ──"
for url in "https://vizzor.ai/api/health" "https://test.vizzor.ai/api/health"; do
  printf "  %s\n" "$url"
  curl -s --max-time 10 "$url" | jq '{status, sqlite: .subsystems.sqlite.ok, watcher: .subsystems.watcher.ok}' 2>/dev/null \
    || echo "    (no JSON yet — container still warming up; re-check in ~30s)"
  echo ""
done

echo "DONE."
echo ""
echo "If either health probe is missing, give it ~30s more and re-run:"
echo "  curl -s https://vizzor.ai/api/health      | jq"
echo "  curl -s https://test.vizzor.ai/api/health | jq"
echo ""
echo "From here, every push to testing -> test.vizzor.ai auto-deploys,"
echo "every push to main -> vizzor.ai auto-deploys, via the GHA workflow."
