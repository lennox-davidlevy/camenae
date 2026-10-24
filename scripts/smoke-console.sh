#!/bin/sh
set -eu
umask 077
mkdir -p .cache
env_file=$(mktemp .cache/console-check.XXXXXX)
auth_directory="$env_file-auth"
project="camenae-console-$(date +%s)-$$"
unset CAMENAE_DATABASE_PASSWORD CAMENAE_HTTP_PORT CAMENAE_ORIGIN CAMENAE_AUTH_FILE CAMENAE_OPENCODE_PASSWORD
bun scripts/auth-init.ts "$auth_directory"
bun -e 'console.log("CAMENAE_DATABASE_PASSWORD="+crypto.randomUUID());console.log("CAMENAE_OPENCODE_PASSWORD="+crypto.randomUUID());console.log("CAMENAE_HTTP_PORT=0");console.log("CAMENAE_INFERENCE_PREFIX=172.30.89")' > "$env_file"
printf 'CAMENAE_AUTH_FILE=%s/%s/credentials.json\n' "$PWD" "$auth_directory" >> "$env_file"
dc() { docker compose --env-file "$env_file" --project-name "$project" -f compose.yaml -f tests/images.compose.yaml "$@"; }
cleanup() {
  dc down --volumes --remove-orphans >/dev/null 2>&1 || true
  sh scripts/cleanup-test-images.sh
  rm -f "$env_file" "$auth_directory/credentials.json" "$auth_directory/login.txt"
  rmdir "$auth_directory"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
dc build app opencode-worker
# No egress service: even an accidentally unmocked provider request cannot leave.
dc up -d --wait --wait-timeout 120 postgres opencode-worker
dc run --rm --no-deps --use-aliases -T app bun tests/console-settings.ts < "$auth_directory/login.txt"
dc up -d --wait --wait-timeout 120 opencode-worker
dc exec -T opencode-worker bun -e 'import{readFile,access}from"node:fs/promises";for(const pid of (await readFile("/data/workspace/console-revocation.pid","utf8")).trim().split(" ")){try{await access("/proc/"+pid);throw new Error("Revoked process survived")}catch(e){if(e.code!=="ENOENT")throw e}}'
printf 'Console setup acceptance passed without live inference.\n'
