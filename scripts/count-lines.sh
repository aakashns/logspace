#!/usr/bin/env bash
# Counts the repo's non-blank lines of source, test, and config code (docs, fixtures, and lockfiles
# aren't code). Includes files git doesn't track yet, unless they're ignored.
#
#   scripts/count-lines.sh [-v]    -v lists each file's count too

set -euo pipefail
cd "$(dirname "$0")/.."

source=0 test=0 config=0
while IFS= read -r file; do
  [[ -f $file ]] || continue
  case $file in
    *.test.ts | platform/test/* | */binary/smoke-test.sh | */binary/fake-s3.ts) kind=test ;;
    platform/app/* | platform/binary/*.ts | platform/server.ts | platform/db/migrations/*.sql | scripts/*)
      kind=source ;;
    *.json | *.toml | .github/* | */.gitignore) kind=config ;;
    *) continue ;;
  esac
  case $file in *.lock | */test/content/* | *.woff2) continue ;; esac
  lines=$(grep -c . "$file" || true)
  eval "$kind=\$(($kind + lines))"
  if [[ ${1-} == -v ]]; then printf '%6d  %-6s  %s\n' "$lines" "$kind" "$file"; fi
done < <(git ls-files --cached --others --exclude-standard | sort)

printf '%-7s %6d\n' source "$source" test "$test" config "$config" total $((source + test + config))
