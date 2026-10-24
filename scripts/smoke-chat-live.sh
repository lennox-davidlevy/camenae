#!/bin/sh
set -eu

# Explicitly live: synthetic prompts and public Context7 queries only, in a disposable project and workspace.
if docker compose version >/dev/null 2>&1; then
  compose() { docker compose "$@"; }
else
  compose() { docker-compose "$@"; }
fi
bun -e 'if (!process.env.BOB_API_KEY?.trim()) throw new Error("BOB_API_KEY is required")'
umask 077
env_file=$(mktemp .cache/chat-live.XXXXXX)
auth_directory="$env_file-auth"
project="camenae-live-$(date +%s)-$$"
bun scripts/auth-init.ts "$auth_directory"
bun -e 'console.log("CAMENAE_DATABASE_PASSWORD=" + crypto.randomUUID()); console.log("CAMENAE_HTTP_PORT=0"); console.log("CAMENAE_INFERENCE_PREFIX=172.30.85")' > "$env_file"
printf 'CAMENAE_AUTH_FILE=%s/%s/credentials.json\n' "$PWD" "$auth_directory" >> "$env_file"
dc() { compose --env-file "$env_file" --project-name "$project" -f compose.yaml -f tests/images.compose.yaml "$@"; }
cleanup() {
  dc down --volumes --remove-orphans >/dev/null 2>&1 || true
  sh scripts/cleanup-test-images.sh
  rm -f "$env_file" "$auth_directory/credentials.json" "$auth_directory/login.txt" "$auth_directory/state.json" "$auth_directory/next.json"
  rmdir "$auth_directory"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
dc up -d --build --wait --wait-timeout 90
worker=$(dc ps -q worker)
started=$(docker inspect --format '{{.State.StartedAt}}' "$worker")
wait_worker() {
  attempt=0
  while test "$(docker inspect --format '{{.State.StartedAt}}' "$worker")" = "$started"; do
    attempt=$((attempt + 1))
    test "$attempt" -lt 30
    sleep 1
  done
  dc up -d --wait --wait-timeout 90 worker
}
# The key travels only through stdin to the authenticated onboarding endpoint.
bun -e 'console.log(JSON.stringify({password:(await Bun.file(process.argv[1]).text()).trim(),apiKey:process.env.BOB_API_KEY}))' "$auth_directory/login.txt" |
  dc exec -T app bun tests/chat-live.ts seed > "$auth_directory/state.json"
# Ordinary responses must leave the worker and its Bob process alive. This is
# the primary regression boundary for per-message teardown, not an SDK mock.
test "$(docker inspect --format '{{.State.StartedAt}}' "$worker")" = "$started"
bob_processes=$(dc exec -T worker ps -eo pid,lstart,comm | awk '$NF == "node" || $NF == "bun"')
test -n "$bob_processes"
dc exec -T app bun tests/chat-live.ts followup < "$auth_directory/state.json" >/dev/null
test "$(docker inspect --format '{{.State.StartedAt}}' "$worker")" = "$started"
test "$(dc exec -T worker ps -eo pid,lstart,comm | awk '$NF == "node" || $NF == "bun"')" = "$bob_processes"
for mode in reauth recovery cancel cancel-running switch revoke idle-revoke; do
  worker=$(dc ps -q worker)
  started=$(docker inspect --format '{{.State.StartedAt}}' "$worker")
  bun -e 'console.log(JSON.stringify({...await Bun.file(process.argv[1]).json(),password:(await Bun.file(process.argv[2]).text()).trim()}))' "$auth_directory/state.json" "$auth_directory/login.txt" |
    dc exec -T app bun tests/chat-controls.ts "$mode" > "$auth_directory/next.json"
  mv "$auth_directory/next.json" "$auth_directory/state.json"
  case "$mode" in
    reauth|revoke|idle-revoke) wait_worker ;;
    *) test "$(docker inspect --format '{{.State.StartedAt}}' "$worker")" = "$started" ;;
  esac
done
dc exec -T app bun tests/mcp-settings-live.ts < "$auth_directory/state.json"
dc exec -T app bun tests/approval-live.ts exercise < "$auth_directory/state.json"
dc up -d --force-recreate --wait --wait-timeout 90
dc exec -T app bun tests/approval-live.ts retained < "$auth_directory/state.json"
dc exec -T app bun tests/chat-live.ts resume < "$auth_directory/state.json" >/dev/null
printf 'Live chat passed: saved-key onboarding, real streamed tool task, cross-tab admission, container replacement, native conversation resume, Context7 lookup in new and resumed sessions.\n'
