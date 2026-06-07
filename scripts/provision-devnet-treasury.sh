#!/usr/bin/env bash
#
# provision-devnet-treasury.sh — generate the staging Solana treasury,
# fund it from the devnet faucet, and patch its pubkey into
# /opt/7aylabs/.env.staging.
#
# Idempotent — if /root/.vizzor-staging/treasury.json already exists,
# we read the pubkey from it instead of generating a new one. So the
# first run provisions, subsequent runs just confirm the value is set
# in the env file.
#
# Solana CLI is installed automatically if not present. The install is
# the official one-liner from release.anza.xyz; it lands a single
# `solana` binary under /root/.local/share/solana/install/active_release.
#
# Usage:
#   sudo bash /srv/site-vizzor/scripts/provision-devnet-treasury.sh
#
# After this completes, the staging stack can be brought up:
#   cd /opt/7aylabs
#   docker compose -f docker-compose.yml -f docker-compose.staging.yml \
#     up -d site-vizzor-staging

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: this script must be run as root (use sudo)" >&2
  exit 2
fi

STACK_DIR="/opt/7aylabs"
STAGING_ENV="$STACK_DIR/.env.staging"
TREASURY_DIR="/root/.vizzor-staging"
TREASURY_KEY="$TREASURY_DIR/treasury.json"

if [[ ! -f "$STAGING_ENV" ]]; then
  echo "ERROR: $STAGING_ENV not found. Run configure-env.sh first." >&2
  exit 1
fi

# ─── 1. Make sure solana CLI is available ───────────────────────────────
if ! command -v solana &>/dev/null; then
  if [[ -x /root/.local/share/solana/install/active_release/bin/solana ]]; then
    export PATH="/root/.local/share/solana/install/active_release/bin:$PATH"
  fi
fi

if ! command -v solana &>/dev/null; then
  echo "▶ Installing solana CLI (one-time, ~30s)"
  # /tmp is mounted noexec on hardened VPSes — the installer extracts
  # agave-install-init to TMPDIR and runs it, so noexec /tmp blocks the
  # install. Point TMPDIR at a root-owned, executable scratch dir.
  INSTALL_TMP="/root/.solana-install-cache"
  mkdir -p "$INSTALL_TMP"
  chmod 700 "$INSTALL_TMP"
  TMPDIR="$INSTALL_TMP" sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
  export PATH="/root/.local/share/solana/install/active_release/bin:$PATH"
fi

solana --version

# ─── 2. Generate the treasury keypair if not already present ────────────
mkdir -p "$TREASURY_DIR"
chmod 700 "$TREASURY_DIR"

if [[ -f "$TREASURY_KEY" ]]; then
  echo "▶ Using existing treasury keypair at $TREASURY_KEY"
else
  echo "▶ Generating new devnet treasury keypair"
  solana-keygen new \
    --no-bip39-passphrase \
    --silent \
    --outfile "$TREASURY_KEY"
  chmod 600 "$TREASURY_KEY"
fi

PUBKEY="$(solana-keygen pubkey "$TREASURY_KEY")"
echo "  Treasury pubkey: $PUBKEY"

# ─── 3. Point the local CLI at devnet ───────────────────────────────────
solana config set --url https://api.devnet.solana.com --keypair "$TREASURY_KEY" >/dev/null

# ─── 4. Patch the env file ──────────────────────────────────────────────
if grep -q "^VIZZOR_SOLANA_TREASURY_DEVNET=__OPERATOR_REQUIRED__" "$STAGING_ENV"; then
  echo "▶ Patching VIZZOR_SOLANA_TREASURY_DEVNET in $STAGING_ENV"
  cp -a "$STAGING_ENV" "$STAGING_ENV.bak.$(date +%Y%m%d-%H%M%S)"
  sed -i "s|^VIZZOR_SOLANA_TREASURY_DEVNET=__OPERATOR_REQUIRED__|VIZZOR_SOLANA_TREASURY_DEVNET=$PUBKEY|" "$STAGING_ENV"
else
  CURRENT="$(grep -E '^VIZZOR_SOLANA_TREASURY_DEVNET=' "$STAGING_ENV" | head -1 | cut -d= -f2-)"
  if [[ "$CURRENT" == "$PUBKEY" ]]; then
    echo "▶ $STAGING_ENV already has the correct treasury pubkey"
  else
    echo "▶ $STAGING_ENV already has a treasury pubkey ($CURRENT)"
    echo "  Leaving in place. Re-run by hand if you intend to swap it for $PUBKEY."
  fi
fi

# ─── 5. Fund from the devnet faucet (best-effort) ───────────────────────
echo "▶ Requesting 2 devnet SOL from the faucet"
if solana airdrop 2 "$PUBKEY" --url https://api.devnet.solana.com 2>&1; then
  echo "  Airdrop ok."
else
  echo "  Airdrop failed (rate-limit on this IP is common). Retry later with:"
  echo "    solana airdrop 2 $PUBKEY --url devnet"
  echo "  Or use the web faucet at https://faucet.solana.com/?address=$PUBKEY&cluster=devnet"
fi

BALANCE="$(solana balance "$PUBKEY" --url https://api.devnet.solana.com 2>/dev/null || echo unknown)"
echo "  Current balance: $BALANCE"

echo ""
echo "── Summary ──"
echo "  Treasury keypair: $TREASURY_KEY  (600 root-only)"
echo "  Pubkey:           $PUBKEY"
echo "  Network:          devnet"
echo "  Env file:         $STAGING_ENV"
echo ""
echo "── Verify the patch ──"
grep -H 'VIZZOR_SOLANA_TREASURY_DEVNET' "$STAGING_ENV"
echo ""
echo "── Next ──"
echo "Bring the staging container up:"
echo "  cd $STACK_DIR"
echo "  docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d site-vizzor-staging"
echo ""
echo "DONE."
