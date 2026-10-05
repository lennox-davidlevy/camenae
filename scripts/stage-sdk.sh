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
  fce9502efaf7314d48bc67af86728e0cb51f174af2b78a115adebef3f11eb4d2)
    target=.cache/sdk/camenae-bob-0.5.0-managed-modes-fce9502efaf7.tgz ;;
  b24e7392380263b72f1db9cdcb266b677dbd3ceddcc9bfe35dafc1d8f7839e22)
    target=.cache/sdk/camenae-opencode-0.1.0-b24e73923802.tgz ;;
  *) printf 'SDK checksum mismatch; nothing staged. Obtain the exact identified artifact.\n' >&2; exit 1 ;;
esac
if test -e "$target" || test -L "$target"; then
  printf '%s  %s\n' "$expected" "$target" | sha256sum -c -
else
  mkdir -p .cache/sdk
  cp -n "$1" "$target"
  printf '%s  %s\n' "$expected" "$target" | sha256sum -c -
fi
