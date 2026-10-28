#!/bin/sh
# Retagging leaves old images dangling. Never prune deployment or unrelated images.
# Docker also protects images still referenced by containers.
if ! docker image prune --force --filter 'label=app.camenae.test-image=true' >/dev/null; then
  printf 'Warning: could not remove superseded Camenae test images.\n' >&2
fi
