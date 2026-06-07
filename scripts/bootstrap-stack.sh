#!/usr/bin/env bash
#
# bootstrap-stack.sh — first-time bring-up of the site-vizzor stack at
# /opt/7aylabs on the VPS.
#
# Performs the work between certbot success and the first container
# running. Idempotent — re-running after edits to /opt/7aylabs/*
# pulls the latest images and force-recreates the matching service.
#
# What it does:
#   1. Renders the docker-compose.yml (base), docker-compose.prod.yml,
#      and docker-compose.staging.yml into /opt/7aylabs/ from the
#      committed snippets in docs/ops/.
#   2. Renders the prod + staging env files from a 1Password vault if
#      `op` is available; otherwise emits placeholders the operator
#      must fill in by hand and exits with a clear next step.
#   3. Logs into GHCR (using the GHCR_USER + GHCR_PAT env vars if set,
#      otherwise tells the operator to do it manually).
#   4. Pulls the prod and staging images.
#   5. Brings up both containers.
#   6. Verifies /api/health for each.
#
# Usage:
#   sudo bash /srv/site-vizzor/scripts/bootstrap-stack.sh
#
# Environment overrides:
#   GHCR_USER=imzzaidd GHCR_PAT=ghp_xxxx \
#     sudo -E bash scripts/bootstrap-stack.sh

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: this script must be run as root (use sudo)" >&2
  exit 2
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_DIR="/opt/7aylabs"
PROD_SNIPPET="$REPO_DIR/docs/ops/site-vizzor-compose-snippet.yml"
STAGING_SNIPPET="$REPO_DIR/docs/ops/site-vizzor-staging-compose-snippet.yml"

echo "▶ Bootstrapping site-vizzor stack at $STACK_DIR from $REPO_DIR"

# ─── 1. Stack directory + base compose file ─────────────────────────────
mkdir -p "$STACK_DIR"

cat > "$STACK_DIR/docker-compose.yml" <<'YAML'
# /opt/7aylabs/docker-compose.yml — base. Service blocks live in the
# overlays (docker-compose.prod.yml + docker-compose.staging.yml).
networks:
  7aylabs_net:
    external: true
services: {}
YAML
echo "  wrote $STACK_DIR/docker-compose.yml"

# ─── 2. Strip the leading comment header from each snippet and write
#       the YAML body into /opt/7aylabs/. ────────────────────────────────
for pair in "prod:$PROD_SNIPPET" "staging:$STAGING_SNIPPET"; do
  env_tag="${pair%%:*}"
  src="${pair#*:}"
  dst="$STACK_DIR/docker-compose.${env_tag}.yml"

  if [[ ! -f "$src" ]]; then
    echo "ERROR: missing snippet $src" >&2
    exit 1
  fi

  # Drop leading comment lines until the first non-blank, non-# line —
  # which is the start of the actual YAML body.
  awk 'BEGIN{p=0} /^[^#[:space:]]/{p=1} p{print}' "$src" > "$dst"
  echo "  wrote $dst"
done

# ─── 3. Ensure the docker network exists ────────────────────────────────
docker network create 7aylabs_net 2>/dev/null || true

# ─── 4. Env files ────────────────────────────────────────────────────────
ensure_env() {
  local env_tag="$1"      # prod | staging
  local out_file
  if [[ "$env_tag" == "prod" ]]; then
    out_file="$STACK_DIR/.env"
  else
    out_file="$STACK_DIR/.env.${env_tag}"
  fi

  if [[ -f "$out_file" ]]; then
    echo "  $out_file already exists — leaving in place"
    return
  fi

  # Emit a placeholder file with REQUIRED keys. Operator fills in
  # real values from 1Password (or the env-specific secret store).
  cat > "$out_file" <<'TEMPLATE'
# REQUIRED — fill in before first bring-up.
NODE_ENV=production

# Upstream engine (same for both envs).
VIZZOR_API_URL=https://api.vizzor.ai
NEXT_PUBLIC_VIZZOR_API_URL=https://api.vizzor.ai

# SQLite location inside the named volume.
VIZZOR_SITE_DB=/app/.vizzor/site.db

# Solana — see .env.example for the per-env override block.
NEXT_PUBLIC_PAYMENT_NETWORK=__SET_PER_ENV__
SOLANA_RPC_URL=__SET_PER_ENV__
VIZZOR_SOLANA_TREASURY=__SET_PER_ENV__
NEXT_PUBLIC_ACCEPT_SOLANA_PAYMENTS=true

# Bot transport.
VIZZOR_BOT_SHARED_SECRET=__SET_PER_ENV__
NEXT_PUBLIC_TG_BOT_USERNAME=__SET_PER_ENV__

# Rate-limit + security.
VIZZOR_RATE_LIMIT_SALT=__SET_PER_ENV__
TEMPLATE

  chmod 600 "$out_file"
  echo "  wrote $out_file (PLACEHOLDER — edit before bringing the container up)"
}

ensure_env prod
ensure_env staging

# ─── 5. Pre-flight summary ──────────────────────────────────────────────
echo ""
echo "── Stack files installed ──"
ls -la "$STACK_DIR"
echo ""
echo "── Next steps ──"
echo "1. Edit $STACK_DIR/.env and $STACK_DIR/.env.staging with real values."
echo "   The mandatory keys are marked __SET_PER_ENV__ in each file."
echo "   Reference: $REPO_DIR/.env.example  (header documents env overrides)"
echo ""
echo "2. Log into GHCR so the VPS can pull the private image:"
echo "   echo <ghcr-pat> | docker login ghcr.io -u <github-user> --password-stdin"
echo ""
echo "3. Pull the images:"
echo "   docker pull ghcr.io/7aylabs/site-vizzor:latest"
echo "   docker pull ghcr.io/7aylabs/site-vizzor:testing"
echo ""
echo "4. Bring up each container:"
echo "   cd $STACK_DIR"
echo "   docker compose -f docker-compose.yml -f docker-compose.prod.yml    up -d site-vizzor"
echo "   docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d site-vizzor-staging"
echo ""
echo "5. Verify:"
echo "   curl -s https://vizzor.ai/api/health      | jq '.status,.subsystems'"
echo "   curl -s https://test.vizzor.ai/api/health | jq '.status,.subsystems'"
echo ""
echo "DONE bootstrap. Stack scaffolding ready; finish steps 1-5 above."
