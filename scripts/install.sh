#!/usr/bin/env bash
# Installs the systemd service and the Caddy site config on the server, for the site's domain and
# any others that should redirect to it:
#
#   scripts/install.sh example.com www.example.com
#
# The domains are saved, so later runs (after the service file or Caddyfile changes) can leave them
# out. Existing Caddy site blocks for these domains are replaced. The app's port is PORT in the env
# file (44100 when it isn't set), which Caddy is pointed at, so run this again after changing it.
# Run as root.
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME=logspace
SERVICE_FILE="$SCRIPTS_DIR/$SERVICE_NAME.service"
ENV_FILE="$(sed -n 's/^EnvironmentFile=//p' "$SERVICE_FILE")"
DOMAINS_FILE="/etc/$SERVICE_NAME.domains"
DEFAULT_PORT=44100
CADDYFILE=/etc/caddy/Caddyfile
APP_DIR="$(dirname "$SCRIPTS_DIR")/webapp"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root" >&2
  exit 1
fi

if (( $# > 0 )); then
  DOMAINS="$*"
elif [[ -f "$DOMAINS_FILE" ]]; then
  DOMAINS="$(cat "$DOMAINS_FILE")"
else
  echo "Usage: $0 <domain> [<domain to redirect to it>...], e.g. $0 example.com www.example.com" >&2
  exit 1
fi
for domain in $DOMAINS; do
  if [[ ! "$domain" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
    echo "Not a domain: $domain" >&2
    exit 1
  fi
done
read -r SITE_DOMAIN REDIRECT_DOMAINS <<< "$DOMAINS"

if [[ ! -d "$APP_DIR/node_modules" ]]; then
  echo "$APP_DIR/node_modules not found. Clone the repo there and run npm ci first." >&2
  exit 1
fi

# Secrets and the port live outside the repo in a root-only file that the service loads. Create it
# once with a random session secret and the default port; set the admin password with
# set-admin-password.sh.
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Creating $ENV_FILE..."
  # Generated first so that a failing openssl stops the script (set -e) instead of writing an
  # empty secret.
  session_secret="$(openssl rand -base64 32)"
  (
    umask 077
    printf 'ADMIN_PASSWORD=\nAUTH_SESSION_SECRET=%s\nPORT=%s\n' "$session_secret" "$DEFAULT_PORT" \
      > "$ENV_FILE"
  )
fi
chmod 600 "$ENV_FILE"

# The service's port: the env file's PORT (its last one, as systemd reads it, without quotes), else
# the service file's default.
PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" | tail -n 1 | tr -d "\"'")"
PORT="${PORT:-$DEFAULT_PORT}"
if [[ ! "$PORT" =~ ^[1-9][0-9]{0,4}$ ]] || (( PORT > 65535 )); then
  echo "Not a port: PORT=$PORT in $ENV_FILE" >&2
  exit 1
fi
echo "The app listens on port $PORT"

echo "Installing $SERVICE_NAME.service..."
sed "s|@APP_DIR@|$APP_DIR|" "$SERVICE_FILE" > "/etc/systemd/system/$SERVICE_NAME.service"
chmod 644 "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo "Updating $CADDYFILE..."
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
touch "$CADDYFILE"

# Drop existing top-level site blocks whose addresses are all in $DOMAINS. A block
# that mixes these domains with other sites is left for manual editing.
awk -v domains="$DOMAINS" '
  function strip_comment(s) {
    if (s ~ /^[ \t]*#/) return ""
    sub(/[ \t]#.*$/, "", s)
    return s
  }
  function count(s, ch,   t) { t = s; return gsub(ch, "", t) }
  function host(addr) {
    sub(/^[a-zA-Z]+:\/\//, "", addr)
    sub(/\/.*$/, "", addr)
    sub(/:[0-9]+$/, "", addr)
    return tolower(addr)
  }
  BEGIN {
    n = split(domains, list, " ")
    for (i = 1; i <= n; i++) target[list[i]] = 1
  }
  {
    code = strip_comment($0)
    opens = count(code, "{")
    closes = count(code, "}")

    if (skipping) {
      depth += opens - closes
      if (depth <= 0) { skipping = 0; depth = 0 }
      next
    }

    if (depth > 0) {
      depth += opens - closes
      if (depth < 0) depth = 0
      print
      next
    }

    # Top level: collect address lines until the block opens
    pending = pending $0 "\n"
    addrs = addrs " " code
    if (code ~ /,[ \t]*$/) next

    if (opens > 0) {
      a = addrs
      sub(/\{.*$/, "", a)
      gsub(/,/, " ", a)
      m = split(a, parts, /[ \t]+/)
      matched = 0; other = 0
      for (i = 1; i <= m; i++) {
        if (parts[i] == "") continue
        if (host(parts[i]) in target) matched = 1; else other = 1
      }
      if (matched && other) {
        print "Site block mixes these domains with others, edit it manually:" a > "/dev/stderr"
        failed = 1
        exit 1
      }
      depth = opens - closes
      if (matched) {
        if (depth > 0) skipping = 1; else depth = 0
        pending = ""; addrs = ""
        next
      }
    }

    printf "%s", pending
    pending = ""; addrs = ""
  }
  END { if (!failed) printf "%s", pending }
' "$CADDYFILE" |
  # Collapse runs of blank lines left behind by removed blocks, drop trailing ones
  awk 'NF { if (blank && seen) print ""; print; seen = 1; blank = 0; next } { blank = 1 }' > "$tmp"

{
  [[ -s "$tmp" ]] && echo
  grep -v '^#' "$SCRIPTS_DIR/Caddyfile" | sed -e "s|@DOMAIN@|$SITE_DOMAIN|" -e "s|@PORT@|$PORT|"
  for domain in $REDIRECT_DOMAINS; do
    printf '\n%s {\n\tredir https://%s{uri} permanent\n}\n' "$domain" "$SITE_DOMAIN"
  done
} >> "$tmp"

# Validate the candidate before touching the live file, and roll back if Caddy rejects it on reload
caddy validate --config "$tmp" --adapter caddyfile
cp "$CADDYFILE" "$CADDYFILE.bak"
install -m 644 "$tmp" "$CADDYFILE"
if ! systemctl reload caddy; then
  echo "Caddy reload failed, restoring previous $CADDYFILE" >&2
  install -m 644 "$CADDYFILE.bak" "$CADDYFILE"
  exit 1
fi

echo "$DOMAINS" > "$DOMAINS_FILE"
echo "Done. Previous Caddyfile saved to $CADDYFILE.bak"
