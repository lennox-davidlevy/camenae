#!/bin/sh
set -eu

# HTTP persistence and worker replacement acceptance, without a live Bob key.
# Only the unique project's disposable resources are changed or removed.
if docker compose version >/dev/null 2>&1; then
  compose() { docker compose "$@"; }
else
  compose() { docker-compose "$@"; }
fi
mkdir -p .cache
umask 077
env_file=$(mktemp .cache/mcp-check.XXXXXX)
auth_directory="$env_file-auth"
project="camenae-mcp-$(date +%s)-$$"
unset CAMENAE_DATABASE_PASSWORD CAMENAE_HTTP_PORT CAMENAE_ORIGIN CAMENAE_AUTH_FILE BOB_API_KEY
bun scripts/auth-init.ts "$auth_directory"
bun -e 'console.log("CAMENAE_DATABASE_PASSWORD=" + crypto.randomUUID()); console.log("CAMENAE_HTTP_PORT=0"); console.log("CAMENAE_INFERENCE_PREFIX=172.30.86")' > "$env_file"
printf 'CAMENAE_AUTH_FILE=%s/%s/credentials.json\n' "$PWD" "$auth_directory" >> "$env_file"
dc() { compose --env-file "$env_file" --project-name "$project" -f compose.yaml -f tests/mcp.compose.yaml "$@"; }
cleanup() {
  dc down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -f "$env_file" "$auth_directory/credentials.json" "$auth_directory/login.txt" "$auth_directory/session.json" "$auth_directory/state.json"
  rmdir "$auth_directory"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
dc up -d --build --wait --wait-timeout 90
dc exec -T app bun tests/identity.ts seed < "$auth_directory/login.txt" > "$auth_directory/session.json"
dc exec -T app bun tests/mcp-settings.ts exercise < "$auth_directory/session.json" > "$auth_directory/state.json"
dc exec -T app bun tests/approval-settings.ts exercise < "$auth_directory/state.json"
dc exec -T worker bun tests/egress.ts --mcp-gate
# Actual full container replacement, not merely a remote disconnect.
dc up -d --force-recreate --wait --wait-timeout 90
dc exec -T app bun src/main.ts check-runtime
# The diagnostic also owns a single-use worker connection. Fully replace it
# before the application's separate connection to avoid testing a stale socket.
dc restart worker
dc up -d --wait --wait-timeout 90 worker
dc exec -T app bun tests/mcp-settings.ts retained < "$auth_directory/state.json" >/dev/null
dc exec -T app bun tests/approval-settings.ts retained < "$auth_directory/state.json"
# Stop the complete worker before installing each test-owned unmanaged file.
# Each refusal has a healthy positive control and must leave the bytes intact.
for config in mcp.json custom_modes.yaml; do
  dc stop worker
  dc exec -T app bun -e 'const name=process.argv[1]; const p="/data/workspace/.bob/"+name; await Bun.write(p+".saved",await Bun.file(p).text()); await Bun.write(p,name==="mcp.json" ? "{\"mcpServers\":{\"user-owned\":{}}}" : "customModes: []\n");' "$config"
  dc start worker
  dc exec -T app bun tests/mcp-settings.ts failure "$config" < "$auth_directory/state.json" >/dev/null
  dc stop worker
  dc exec -T app bun -e 'const p="/data/workspace/.bob/"+process.argv[1]; await require("node:fs/promises").rename(p+".saved",p);' "$config"
  dc up -d --wait --wait-timeout 90 worker
  dc exec -T app bun tests/mcp-settings.ts recover < "$auth_directory/state.json" >/dev/null
done
# Exercise Chat's attribution consumer with real Postgres and controlled SDK
# events. Stop the HTTP process so only one Chat lifecycle owns running rows.
dc stop app
dc run --rm --no-deps -T app bun tests/approval-observability.ts < "$auth_directory/state.json"
dc run --rm --no-deps -T app bun tests/mcp-permissions.ts
dc run --rm --no-deps -T app bun tests/mcp-native.ts < "$auth_directory/state.json"
# The usage consumer also owns the mixed-harness deep-link fixture; run its Bob
# assertions with an unavailable OpenCode default instead of duplicating them.
dc run --rm --no-deps -T -e CAMENAE_HARNESS=opencode app bun tests/session-usage.tsx --mixed-harness < "$auth_directory/login.txt"
printf 'MCP settings passed: authorization, persistence, replacement/resume, unmanaged-file refusal, pending failure status, recovery and re-enablement.\n'
