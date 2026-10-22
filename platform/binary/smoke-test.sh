#!/usr/bin/env bash
# Checks that a built binary works on this machine: runs it from an empty folder, behind a pretend
# reverse proxy, logs in, configures the site, publishes a photos post, and fetches the pages,
# assets, and images sharp makes. Then it does the same with media in a pretend S3 bucket that's
# slow to send files (binary/fake-s3.ts, run with bun). CI runs it on every binary it releases.
#
#   binary/smoke-test.sh dist/logspace
set -euo pipefail

BINARY="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
BINARY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PHOTO="$BINARY_DIR/../test/content/posts/drdp3ei6fd/hike-1.jpg"
PORT="${SMOKE_TEST_PORT:-44190}"
S3_PORT=$((PORT + 1))
# Longer than Bun's default idle timeout (10 seconds), which closed connections like these.
S3_DELAY=12
ORIGIN=https://logspace.test
BASE="http://127.0.0.1:$PORT"

work="$(mktemp -d)"
pids=()
stop() {
  local pid
  for pid in ${pids[@]+"${pids[@]}"}; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  pids=()
}
trap 'stop; rm -rf "$work"' EXIT

log=
fail() {
  echo "FAIL: $*" >&2
  if [[ -n "$log" ]]; then
    echo "--- server log" >&2
    cat "$log" >&2
  fi
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
# Form posts carry the proxy's origin, which cop() checks against the forwarded URL's host (there's
# no Sec-Fetch-Site for it to go by), and each is answered with a redirect once it's done.
post() {
  local got
  got="$(request -o /dev/null -w '%{http_code}' -H "Origin: $ORIGIN" -X POST "$@")"
  [[ "$got" == 30[23] ]] || fail "expected a redirect, got $got: POST ${*: -1}"
  echo "ok POST ${*: -1}"
}

# Starts the binary in its own empty folder, with any extra settings given (NAME=value), and
# without NODE_ENV, which its environment needn't have.
start() {
  local dir="$work/$1"
  shift
  mkdir "$dir"
  log="$dir/server.log"
  (cd "$dir" && exec env -u NODE_ENV PORT="$PORT" TRUST_PROXY=1 ADMIN_PASSWORD=smoke-test-password \
    AUTH_SESSION_SECRET=smoke-test-secret "$@" "$BINARY" > "$log" 2>&1) &
  pids+=($!)
  wait_for "Server listening" "$log"
  session=
}
wait_for() {
  for _ in $(seq 50); do
    grep -q "$1" "$2" && return
    sleep 0.2
  done
  fail "didn't see \"$1\" in $2"
}

# Logs in, configures the site, and publishes a photos post.
publish() {
  session="$(request -o /dev/null -D - -H "Origin: $ORIGIN" -d password=smoke-test-password \
    "$BASE/admin/login" | sed -n 's/^set-cookie: \(admin_session=[^;]*\).*/\1/ip')"
  [[ -n "$session" ]] || fail "couldn't log in"
  echo "ok logged in"
  post -F siteTitle='Smoke Test' -F siteUrl="$ORIGIN" -F siteDescription='A smoke test.' \
    -F heroHeading= -F heroSubheading= -F socialImageAlt= "$BASE/admin/config"
  post -F id=smoketest1 -F type=photos -F date=2026-10-22T09:30 -F offset=+05:30 -F caption= \
    -F photo_file= -F photo_alt=Hike -F photo_width= -F photo_height= \
    -F "photo_upload=@$PHOTO;type=image/jpeg" "$BASE/admin/posts/new"
}

echo "$("$BINARY" --version) on $(uname -sm)"

echo "--- media in a folder"
start local

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

# The forwarded URL, from either kind of header: the standard Forwarded header passes cop()'s check
# on its own, and the config form suggests the forwarded origin as the site's URL.
got="$(curl -sS -o /dev/null -w '%{http_code}' -H "Forwarded: for=192.0.2.1;proto=https;host=logspace.test" \
  -H "Origin: $ORIGIN" -d password=smoke-test-password "$BASE/admin/login")"
[[ "$got" == 302 ]] || fail "a login through a proxy that sends Forwarded got $got"
publish
config_page="$(request "$BASE/admin/config")"
grep -q "value=\"$ORIGIN\"" <<< "$config_page" || fail "the request's URL isn't the forwarded one"
echo "ok forwarded URL"

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
grep -qi error "$log" && fail "the server logged errors"

# An error is answered with a plain 500, not Bun's development page with the stack and code.
error_page="$work/error.html"
got="$(request -o "$error_page" -w '%{http_code}' -H 'Content-Type: multipart/form-data' \
  --data-binary broken "$BASE/admin/login")"
[[ "$got" == 500 ]] || fail "a broken form got $got, not 500"
if grep -q bunfallback "$error_page" || (( $(wc -c < "$error_page") > 100 )); then
  fail "an error's page shows too much: $(head -c 300 "$error_page")"
fi
echo "ok plain error page: $(cat "$error_page")"
stop

echo "--- media in S3, which takes ${S3_DELAY}s to send a file"
bun "$BINARY_DIR/fake-s3.ts" "$S3_PORT" "$S3_DELAY" > "$work/fake-s3.log" 2>&1 &
pids+=($!)
wait_for "Fake S3 listening" "$work/fake-s3.log"
start s3 MEDIA_STORAGE=s3 MEDIA_S3_BUCKET=media MEDIA_S3_REGION=auto \
  MEDIA_S3_ENDPOINT="http://127.0.0.1:$S3_PORT" MEDIA_S3_ACCESS_KEY_ID=key MEDIA_S3_SECRET_ACCESS_KEY=secret
publish
photo_url="$(request "$BASE/posts/smoketest1" | grep -o '/posts/smoketest1/hike-1\.jpg?v=[^"&]*' |
  sed -n 1p || true)"
[[ -n "$photo_url" ]] || fail "the post has no photo"
request -o "$work/photo.jpg" "$BASE$photo_url" ||
  fail "the connection closed while S3 was sending the photo"
cmp -s "$work/photo.jpg" "$PHOTO" || fail "the photo from S3 isn't the one uploaded"
echo "ok photo from slow S3"
grep -qi error "$log" && fail "the server logged errors"

echo "All good"
