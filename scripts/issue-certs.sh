#!/usr/bin/env bash
#
# issue-certs.sh — issue (or renew) Let's Encrypt certs for site-vizzor
# via certbot --nginx. One-shot multi-SAN: vizzor.ai + www.vizzor.ai +
# test.vizzor.ai land on the same cert so renewal stays a single hop.
#
# Pre-flight (must already be true):
#   - scripts/bootstrap-nginx.sh has run successfully
#   - port 80 inbound is reachable from the public internet
#   - DNS A records for all three names point at this VPS
#
# Usage:
#   sudo bash /srv/site-vizzor/scripts/issue-certs.sh [email]
#
#   email defaults to security@vizzor.ai. Override via the first arg
#   if you want notices to land somewhere else.
#
# Idempotent. certbot does nothing destructive on re-run:
#   - if no cert exists, issues a new one
#   - if a cert exists for the same SAN set, --keep-until-expiring no-ops
#   - if the SAN set has changed (we added/removed a domain), certbot
#     re-issues with --expand semantics implied by --cert-name being
#     a stable identifier

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: this script must be run as root (use sudo)" >&2
  exit 2
fi

EMAIL="${1:-security@vizzor.ai}"
CERT_NAME="vizzor.ai"

DOMAINS=(
  vizzor.ai
  www.vizzor.ai
  test.vizzor.ai
)

# Build the -d arg list as an array so the eventual command never has
# to live on one line of text.
D_ARGS=()
for d in "${DOMAINS[@]}"; do
  D_ARGS+=( -d "$d" )
done

echo "▶ Issuing / renewing certificate via certbot --nginx"
echo "  Cert name: $CERT_NAME"
echo "  Email:     $EMAIL"
echo "  Domains:   ${DOMAINS[*]}"
echo ""

certbot --nginx \
  "${D_ARGS[@]}" \
  --cert-name "$CERT_NAME" \
  --email "$EMAIL" \
  --agree-tos \
  --redirect \
  --no-eff-email \
  --keep-until-expiring

echo ""
echo "DONE."
echo ""
echo "Inspect:"
echo "  certbot certificates | grep -A 3 $CERT_NAME"
echo ""
echo "Verify HTTPS reachability:"
echo "  curl -sI https://vizzor.ai/      | head -3   # expect HTTP/2 502 (container down)"
echo "  curl -sI https://test.vizzor.ai/ | head -3   # expect HTTP/2 502 (container down)"
echo ""
echo "Both 502 with valid TLS = success. Next step is container bring-up."
