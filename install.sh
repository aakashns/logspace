#!/bin/sh
# Installs LogSpace (https://github.com/aakashns/logspace) on Linux or macOS:
#
#   curl -fsSL https://raw.githubusercontent.com/aakashns/logspace/main/install.sh | sh
#
# Downloads the latest release for this machine, checks it against the release's SHA256SUMS, and
# installs it at /usr/local/bin/logspace, with sudo if that folder needs it. Running it again
# upgrades (as does `logspace upgrade`). On a server, run `sudo logspace setup` next. Settings, as
# environment variables:
#
#   LOGSPACE_VERSION      install this version instead of the latest (e.g. 0.1.0)
#   LOGSPACE_INSTALL_DIR  install here instead of /usr/local/bin
set -eu

repo="https://github.com/aakashns/logspace"
# Where releases are published. smoke-test.ts points it at pretend ones.
releases="${LOGSPACE_RELEASES_URL:-$repo/releases}"
dir="${LOGSPACE_INSTALL_DIR:-/usr/local/bin}"

fail() {
  printf 'logspace install: %s\n' "$*" >&2
  exit 1
}

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "there's no LogSpace build for $(uname -s); see $repo" ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "there's no LogSpace build for $(uname -m) processors; see $repo" ;;
esac

# A shell running under Rosetta reports x86_64 on Apple Silicon Macs.
if [ "$os-$arch" = darwin-x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = 1 ]; then
  arch=arm64
fi

# The Linux builds need glibc, which Alpine and some other small distributions don't have.
if [ "$os" = linux ] && ldd --version 2>&1 | grep -qi musl; then
  fail "LogSpace needs a Linux with glibc (like Debian or Ubuntu), not musl"
fi

command -v curl >/dev/null || fail "curl is needed to download LogSpace"

binary="logspace-$os-$arch"
if [ -n "${LOGSPACE_VERSION:-}" ]; then
  url="$releases/download/v${LOGSPACE_VERSION#v}"
else
  url="$releases/latest/download"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Downloading $url/$binary..."
curl -fsSL "$url/$binary" -o "$tmp/logspace" || fail "couldn't download $url/$binary"
curl -fsSL "$url/SHA256SUMS" -o "$tmp/SHA256SUMS" || fail "couldn't download $url/SHA256SUMS"

expected=$(awk -v name="$binary" '$2 == name || $2 == "*" name { print $1 }' "$tmp/SHA256SUMS")
if command -v sha256sum >/dev/null; then
  actual=$(sha256sum "$tmp/logspace" | cut -d ' ' -f 1)
elif command -v shasum >/dev/null; then
  actual=$(shasum -a 256 "$tmp/logspace" | cut -d ' ' -f 1)
else
  fail "sha256sum or shasum is needed to check the download"
fi
[ -n "$expected" ] && [ "$expected" = "$actual" ] ||
  fail "the download doesn't match its checksum; please try again"
chmod 755 "$tmp/logspace"

# /usr/local/bin usually belongs to root.
sudo=
if [ "$(id -u)" != 0 ] && ! { mkdir -p "$dir" 2>/dev/null && [ -w "$dir" ]; }; then
  command -v sudo >/dev/null || fail "can't write to $dir; run this as root"
  echo "Installing at $dir/logspace needs sudo"
  sudo=sudo
fi

# Copied next to the destination, then renamed over it, so an existing logspace is replaced in one
# step (a running server keeps its copy) and never left half-written.
$sudo mkdir -p "$dir" || fail "couldn't create $dir"
$sudo cp "$tmp/logspace" "$dir/.logspace.new" || fail "couldn't write to $dir"
$sudo mv -f "$dir/.logspace.new" "$dir/logspace"

echo "Installed LogSpace $("$dir/logspace" version) at $dir/logspace"

command=logspace
found=$(command -v logspace || true)
if [ -z "$found" ]; then
  echo "Note: $dir isn't on your PATH, so run it as $dir/logspace."
  command="$dir/logspace"
elif [ "$found" != "$dir/logspace" ]; then
  echo "Note: running \`logspace\` starts $found, which comes first on your PATH."
  command="$dir/logspace"
fi
if [ "$os" = linux ]; then
  echo "To run it on this server, behind Caddy: sudo $command setup <domain>"
else
  echo "Run \`$command\` to start it at http://localhost:44100 (\`$command help\` for more)."
fi
