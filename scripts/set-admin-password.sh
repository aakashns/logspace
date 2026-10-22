#!/usr/bin/env bash
# Sets the admin password (for /admin) in the service's env file and restarts the service, which
# logs out every browser. The password is read without echoing, so it stays out of shell history.
# Run as root.
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME=logspace
ENV_FILE="$(sed -n 's/^EnvironmentFile=//p' "$SCRIPTS_DIR/$SERVICE_NAME.service")"
MIN_LENGTH=16

if [[ $EUID -ne 0 ]]; then
  echo "Run as root" >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "$ENV_FILE not found. Run install.sh first." >&2
  exit 1
fi

# IFS= keeps leading and trailing spaces, so the check below sees the password as typed.
IFS= read -rsp "New admin password: " password
echo
IFS= read -rsp "Again: " again
echo
if [[ "$password" != "$again" ]]; then
  echo "The passwords don't match" >&2
  exit 1
fi
if (( ${#password} < MIN_LENGTH )); then
  echo "Use at least $MIN_LENGTH characters" >&2
  exit 1
fi
# systemd strips quotes and backslashes and trims spaces when it reads the env file, so a password
# with them would no longer match what was typed.
if [[ "$password" =~ [\"\'\\] || "$password" =~ ^[[:space:]] || "$password" =~ [[:space:]]$ ]]; then
  echo "Use a password without quotes, backslashes, or leading/trailing spaces" >&2
  exit 1
fi

# Rewrite the file without the old line, keeping the others (like AUTH_SESSION_SECRET and PORT)
# and keeping it root-only throughout.
tmp="$(mktemp "$ENV_FILE.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
grep -v '^ADMIN_PASSWORD=' "$ENV_FILE" > "$tmp" || true
printf 'ADMIN_PASSWORD=%s\n' "$password" >> "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$ENV_FILE"

systemctl restart "$SERVICE_NAME"
echo "Password updated and $SERVICE_NAME restarted."
