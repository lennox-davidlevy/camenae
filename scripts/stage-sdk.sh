#!/bin/sh
set -eu

# The dependency is an approved external delivery, not publishable app source.
if test "$#" -ne 1; then
  printf 'Usage: bun run sdk:stage /path/to/approved-sdk.tgz\n' >&2
  exit 1
fi
cd "$(dirname "$0")/.."
actual=$(sha256sum "$1")
expected=${actual%% *}
case "$expected" in
  b2c0d67d6050055115dcbda4bb1f7b94ef57417ba90b42d9f7afa21c6c49fa03)
    target=.cache/sdk/camenae-opencode-0.2.0-b2c0d67d6050.tgz ;;
  *) printf 'SDK checksum mismatch; nothing staged. Obtain the exact identified artifact.\n' >&2; exit 1 ;;
esac
if test -e "$target" || test -L "$target"; then
  printf '%s  %s\n' "$expected" "$target" | sha256sum -c -
else
  mkdir -p .cache/sdk
  cp -n "$1" "$target"
  printf '%s  %s\n' "$expected" "$target" | sha256sum -c -
fi
