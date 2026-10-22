#!/usr/bin/env bash
# Checks that a built binary works on this machine: runs it from an empty folder, behind a pretend
# reverse proxy, logs in, configures the site, publishes a photos post, and fetches the pages,
# assets, and images sharp makes. CI runs it on every binary it releases.
#
#   binary/smoke-test.sh dist/logspace
set -euo pipefail

BINARY="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
PHOTO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/test/content/posts/drdp3ei6fd/hike-1.jpg"
PORT="${SMOKE_TEST_PORT:-44190}"
ORIGIN=https://logspace.test
BASE="http://127.0.0.1:$PORT"

work="$(mktemp -d)"
pid=
cleanup() {
  [[ -n "$pid" ]] && kill "$pid" 2>/dev/null && wait "$pid" 2>/dev/null
  rm -rf "$work"
}
trap cleanup EXIT
cd "$work"

fail() {
  echo "FAIL: $*" >&2
  echo "--- server log" >&2
  cat server.log >&2
  exit 1
}

# Requests as they'd come through the proxy for $ORIGIN, with the admin session once there is one
# (sent by hand: curl keeps a Secure cookie to itself over plain HTTP).
session=
request() {
  curl -sS -H "X-Forwarded-Proto: https" -H "X-Forwarded-Host: logspace.test" \
    ${session:+-H "Cookie: $session"} "$@"
}
# Prints a response's status code.
status() { request -o /dev/null -w '%{http_code}' "$@"; }
expect() {
  local want="$1" got
  shift
  got="$(status "$@")"
  [[ "$got" == "$want" ]] || fail "expected $want, got $got: $*"
  echo "ok $want ${*: -1}"
}

echo "$("$BINARY" --version) on $(uname -sm)"

PORT="$PORT" TRUST_PROXY=1 ADMIN_PASSWORD=smoke-test-password AUTH_SESSION_SECRET=smoke-test-secret \
  "$BINARY" > server.log 2>&1 &
pid=$!
for _ in $(seq 50); do
  grep -q "Server listening" server.log && break
  kill -0 "$pid" 2>/dev/null || fail "the server exited"
  sleep 0.2
done
grep -q "Server listening" server.log || fail "the server didn't start"

# Before the site is configured, pages lead to the login, but the icons (drawn from LogSpace's
# SVG mark by sharp) and public/ are there.
expect 302 "$BASE/"
expect 200 "$BASE/admin/login"
expect 200 "$BASE/favicon.ico"
expect 200 "$BASE/apple-touch-icon.png"
expect 200 "$BASE/fonts/instrument-sans-latin-ext-600.woff2"
expect 404 "$BASE/assets/missing.js"

# Every script the page loads (fingerprinted URLs; the import map's keys are only names) is served,
# with a year's cache.
page="$(request "$BASE/admin/login")"
scripts="$(grep -o '/assets/[^"]*\.@[^"]*' <<< "$page" | sort -u)"
[[ -n "$scripts" ]] || fail "the login page loads no scripts"
for script in $scripts; do
  [[ "$(status "$BASE$script")" == 200 ]] || fail "couldn't load $script"
done
echo "ok $(wc -l <<< "$scripts" | tr -d ' ') scripts"
headers="$(request -o /dev/null -D - "$BASE$(head -n 1 <<< "$scripts")")"
grep -qi 'cache-control:.*immutable' <<< "$headers" || fail "scripts aren't cached"

# Form posts carry the proxy's origin, which cop() checks against the forwarded URL's host (there's
# no Sec-Fetch-Site for it to go by), and each is answered with a redirect once it's done.
post() {
  local got
  got="$(request -o /dev/null -w '%{http_code}' -H "Origin: $ORIGIN" -X POST "$@")"
  [[ "$got" == 30[23] ]] || fail "expected a redirect, got $got: POST ${*: -1}"
  echo "ok POST ${*: -1}"
}
session="$(request -o /dev/null -D - -H "Origin: $ORIGIN" -d password=smoke-test-password "$BASE/admin/login" | sed -n 's/^set-cookie: \(admin_session=[^;]*\).*/\1/ip')"
[[ -n "$session" ]] || fail "couldn't log in"
echo "ok logged in"
# The config form suggests the forwarded origin as the site's URL.
config_page="$(request "$BASE/admin/config")"
grep -q "value=\"$ORIGIN\"" <<< "$config_page" || fail "the request's URL isn't the forwarded one"
echo "ok forwarded URL"
post -F siteTitle='Smoke Test' -F siteUrl="$ORIGIN" -F siteDescription='A smoke test.' \
  -F heroHeading= -F heroSubheading= -F socialImageAlt= "$BASE/admin/config"
post -F id=smoketest1 -F type=photos -F date=2026-10-22T09:30 -F offset=+05:30 -F caption= \
  -F photo_file= -F photo_alt=Hike -F photo_width= -F photo_height= \
  -F "photo_upload=@$PHOTO;type=image/jpeg" "$BASE/admin/posts/new"

expect 200 "$BASE/"
expect 200 "$BASE/rss.xml"
expect 200 "$BASE/posts/smoketest1"
# A resized WebP copy of the photo, made by sharp.
variant="$(request "$BASE/posts/smoketest1" | grep -o '/posts/smoketest1/hike-1\.jpg?w=[^" ]*' |
  sed -n '1s/&amp;/\&/gp' || true)"
[[ -n "$variant" ]] || fail "the post has no resized photos"
[[ "$(request -o /dev/null -w '%{content_type}' "$BASE$variant")" == image/webp ]] ||
  fail "the resized photo isn't WebP"
echo "ok resized $variant"

grep -qi error server.log && fail "the server logged errors"
echo "All good"
