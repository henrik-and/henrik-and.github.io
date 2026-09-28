#!/usr/bin/env bash
# Updates the ?v=... cache busters in gum-demo/index.html.
#
# Each local href/src that has a ?v= query gets the first 8 hex characters of
# the SHA-1 hash of the referenced file. The version changes only when the
# file content changes, so there is nothing to bump by hand.
#
# Usage:
#   tools/bump-version.sh           Update index.html in place.
#   tools/bump-version.sh --check   Exit 1 if index.html is out of date.
#                                   Nothing is written.
set -euo pipefail

cd "$(dirname "$0")/.."
html=index.html
check=false
if [[ "${1:-}" == "--check" ]]; then
  check=true
elif [[ $# -gt 0 ]]; then
  echo "usage: $0 [--check]" >&2
  exit 2
fi

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
cp "$html" "$tmp"

refs=$(grep -oE '(href|src)="[^"?]+\?v=[^"]*"' "$html" \
  | sed -E 's/^(href|src)="([^"?]+)\?v=.*/\2/' | sort -u)

for ref in $refs; do
  if [[ ! -f "$ref" ]]; then
    echo "skip: $ref (file not found)" >&2
    continue
  fi
  hash=$(sha1sum "$ref" | cut -c1-8)
  escaped=$(printf '%s' "$ref" | sed 's/[][\.*^$/]/\\&/g')
  sed -i -E "s/(\"${escaped}\\?v=)[^\"]*\"/\\1${hash}\"/g" "$tmp"
  echo "$ref -> v=$hash"
done

if cmp -s "$html" "$tmp"; then
  echo "index.html is up to date."
  exit 0
fi

if $check; then
  echo "index.html cache busters are out of date. Run tools/bump-version.sh." >&2
  exit 1
fi

cp "$tmp" "$html"
echo "index.html updated."
