#!/bin/sh
set -eu

# All credentials, state and containers belong to this unique disposable project.
umask 077
mkdir -p .cache
env_file=$(mktemp .cache/opencode-check.XXXXXX)
auth_directory="$env_file-auth"
project="camenae-opencode-$(date +%s)-$$"
unset CAMENAE_DATABASE_PASSWORD CAMENAE_HTTP_PORT CAMENAE_ORIGIN CAMENAE_AUTH_FILE CAMENAE_OPENCODE_PASSWORD
bun scripts/auth-init.ts "$auth_directory"
bun -e 'console.log("CAMENAE_DATABASE_PASSWORD="+crypto.randomUUID());console.log("CAMENAE_OPENCODE_PASSWORD="+crypto.randomUUID());console.log("CAMENAE_HTTP_PORT=0");console.log("CAMENAE_INFERENCE_PREFIX=172.30.87")' > "$env_file"
printf 'CAMENAE_AUTH_FILE=%s/%s/credentials.json\n' "$PWD" "$auth_directory" >> "$env_file"
dc() { docker compose --env-file "$env_file" --project-name "$project" -f compose.yaml -f tests/opencode.compose.yaml -f tests/images.compose.yaml "$@"; }
cleanup() {
  dc down --volumes --remove-orphans >/dev/null 2>&1 || true
  sh scripts/cleanup-test-images.sh
  rm -f "$env_file" "$auth_directory/credentials.json" "$auth_directory/login.txt" "$auth_directory/session.json" "$auth_directory/state.json" "$auth_directory/crash.json"
  rmdir "$auth_directory"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
if ! dc up -d --build --wait --wait-timeout 120; then
  dc logs --no-log-prefix opencode-worker
  exit 1
fi
dc exec -T app bun tests/identity.ts seed < "$auth_directory/login.txt" > "$auth_directory/session.json"
dc exec -T app bun tests/opencode-ownership.ts
dc exec -T app bun tests/opencode-retirement.ts
if ! dc exec -T app bun tests/opencode-chat.ts exercise < "$auth_directory/session.json" > "$auth_directory/state.json"; then
  dc logs --no-log-prefix opencode-fixture
  exit 1
fi
dc exec -T opencode-worker bun -e 'import{readFile,access}from"node:fs/promises";for(const pid of (await readFile("/data/workspace/cancellation.pid","utf8")).trim().split(" ")){try{await access("/proc/"+pid);throw new Error("Cancelled process survived")}catch(e){if(e.code!=="ENOENT")throw e}}'
dc exec -T app bun tests/opencode-chat.ts failure < "$auth_directory/state.json"
dc exec -T app bun -e 'import{unlink}from"node:fs/promises";await unlink("/data/workspace/cancellation-started")'
# Crash only the app while native execution is live. A replacement application
# must retire the old worker before reopening the retained native session.
dc exec -T app bun tests/opencode-chat.ts crash < "$auth_directory/state.json" > "$auth_directory/crash.json"
before=$(docker inspect -f '{{.State.StartedAt}}' "$(dc ps -q opencode-worker)")
dc kill -s KILL app
dc up -d --wait --wait-timeout 120 app
dc exec -T app bun tests/opencode-chat.ts resume < "$auth_directory/crash.json"
after=$(docker inspect -f '{{.State.StartedAt}}' "$(dc ps -q opencode-worker)")
test "$before" != "$after"
# Recreate both processes, retaining only this project's volumes.
dc up -d --force-recreate --wait --wait-timeout 120 opencode-worker app
dc exec -T app bun tests/opencode-chat.ts resume < "$auth_directory/state.json"
printf 'OpenCode installed-package/app acceptance passed with a local model fixture; no paid inference.\n'
