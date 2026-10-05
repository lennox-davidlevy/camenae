#!/bin/sh
set -eu

# The dependency is an approved external delivery, not publishable app source.
if test "$#" -ne 1; then
  printf 'Usage: bun run sdk:stage /path/to/approved-sdk.tgz\n' >&2
  exit 1
fi
cd "$(dirname "$0")/.."
expected=fce9502efaf7314d48bc67af86728e0cb51f174af2b78a115adebef3f11eb4d2
target=.cache/sdk/camenae-bob-0.5.0-managed-modes-fce9502efaf7.tgz
actual=$(sha256sum "$1")
if test "${actual%% *}" != "$expected"; then
  printf 'SDK checksum mismatch; nothing staged. Obtain the exact approved artifact.\n' >&2
  exit 1
fi
if test -e "$target" || test -L "$target"; then
  printf '%s  %s\n' "$expected" "$target" | sha256sum -c -
else
  mkdir -p .cache/sdk
  cp -n "$1" "$target"
  printf '%s  %s\n' "$expected" "$target" | sha256sum -c -
fi
