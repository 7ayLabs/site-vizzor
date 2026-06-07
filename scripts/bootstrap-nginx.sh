#!/usr/bin/env bash
#
# bootstrap-nginx.sh — install the site-vizzor nginx configs on the VPS.
#
# Run from any working directory after `git clone`-ing site-vizzor into
# /srv (or wherever). The script resolves config paths relative to its
# own location so it works no matter where the operator invokes it.
#
# Idempotent — re-running after a `git pull` re-installs the latest
# configs and reloads nginx without breaking the existing setup.
#
# Usage:
#   sudo bash /srv/site-vizzor/scripts/bootstrap-nginx.sh
#
# Exit codes:
#   0 — configs installed, nginx -t passed, nginx reloaded
#   1 — nginx -t failed; nothing reloaded (existing setup untouched)
#   2 — script invoked without root

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: this script must be run as root (use sudo)" >&2
  exit 2
fi

# Resolve the repo root from this script's location so we work from
# any clone path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_SITE="$REPO_ROOT/docs/ops/nginx-site-vizzor.conf"
SRC_SNIP="$REPO_ROOT/docs/ops/nginx-site-vizzor-proxy-common.conf"

DST_SITE="/etc/nginx/sites-available/site-vizzor.conf"
DST_SNIP="/etc/nginx/snippets/site-vizzor-proxy-common.conf"
LINK_SITE="/etc/nginx/sites-enabled/site-vizzor.conf"

# Pre-flight — make sure the sources exist.
for f in "$SRC_SITE" "$SRC_SNIP"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: missing source file $f" >&2
    exit 1
  fi
done

# Ensure the destination directories exist (snippets is the common miss).
mkdir -p /etc/nginx/snippets
mkdir -p /etc/nginx/sites-available
mkdir -p /etc/nginx/sites-enabled
mkdir -p /var/www/letsencrypt
chown -R www-data:www-data /var/www/letsencrypt

echo "▶ Installing site-vizzor nginx config from $REPO_ROOT"
echo "  $SRC_SITE  ->  $DST_SITE"
install -m 0644 "$SRC_SITE" "$DST_SITE"

echo "  $SRC_SNIP  ->  $DST_SNIP"
install -m 0644 "$SRC_SNIP" "$DST_SNIP"

echo "▶ Symlinking sites-enabled"
ln -sf "$DST_SITE" "$LINK_SITE"

echo "▶ Validating nginx configuration"
if ! nginx -t; then
  echo "ERROR: nginx -t failed; the running config has NOT been reloaded" >&2
  exit 1
fi

echo "▶ Reloading nginx"
systemctl reload nginx

echo ""
echo "DONE. site-vizzor nginx config installed and active."
echo ""
echo "Verify:"
echo "  curl -sI http://vizzor.ai/      | head -3   # expect HTTP/1.1 502"
echo "  curl -sI http://test.vizzor.ai/ | head -3   # expect HTTP/1.1 502"
echo ""
echo "(502 is correct at this stage — nginx is up, upstream containers are not.)"
echo ""
echo "Next: certbot --nginx -d vizzor.ai -d www.vizzor.ai -d test.vizzor.ai \\"
echo "        --agree-tos --email security@vizzor.ai --redirect --no-eff-email"
