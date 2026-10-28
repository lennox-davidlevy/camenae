#!/bin/sh
set -eu

# Only generated resources in this unique Compose project are removed on exit.
# Never points at the operator's default development volumes or credentials.
if docker compose version >/dev/null 2>&1; then
  compose() { docker compose "$@"; }
else
  compose() { docker-compose "$@"; }
fi
mkdir -p .cache
umask 077
env_file=$(mktemp .cache/foundation.XXXXXX)
project="camenae-check-$(date +%s)-$$"
unset CAMENAE_DATABASE_PASSWORD CAMENAE_HTTP_PORT CAMENAE_ORIGIN CAMENAE_AUTH_FILE CAMENAE_OPENCODE_PASSWORD
bun -e 'console.log("CAMENAE_DATABASE_PASSWORD=" + require("node:crypto").randomBytes(32).toString("hex")); console.log("CAMENAE_OPENCODE_PASSWORD=" + require("node:crypto").randomBytes(32).toString("hex")); console.log("CAMENAE_HTTP_PORT=0");' > "$env_file"
auth_directory="$env_file-auth"
bun scripts/auth-init.ts "$auth_directory"
printf 'CAMENAE_AUTH_FILE=%s/%s/credentials.json\n' "$PWD" "$auth_directory" >> "$env_file"
printf 'CAMENAE_INFERENCE_PREFIX=172.30.84\n' >> "$env_file"
dc() { compose --env-file "$env_file" --project-name "$project" -f compose.yaml -f tests/images.compose.yaml "$@"; }
cleanup() {
  result=$?
  if test "$result" -ne 0; then
    # Capture container state before deleting this disposable project. Never dump
    # environments or application logs, which may contain authentication data.
    dc ps -a >&2 || true
  fi
  docker rm -f "$project-ip-holder" >/dev/null 2>&1 || true
  docker rm -f "$project-host-canary" >/dev/null 2>&1 || true
  dc down --volumes --remove-orphans >/dev/null 2>&1 || true
  sh scripts/cleanup-test-images.sh
  rm -f "$env_file"
  rm -f "$auth_directory/credentials.json" "$auth_directory/login.txt" "$auth_directory/session.json"
  rmdir "$auth_directory"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

dc up -d --build --wait --wait-timeout 120
docker run -d --name "$project-host-canary" --network host --read-only --cap-drop ALL \
  --security-opt no-new-privileges "$(docker inspect --format '{{.Image}}' "$(dc ps -q app)")" \
  node -e 'require("node:http").createServer((q,s)=>s.end("host-canary")).listen(48923,"0.0.0.0")' >/dev/null
docker exec "$project-host-canary" node -e 'fetch("http://127.0.0.1:48923").then(r=>r.text()).then(t=>{if(t!=="host-canary")process.exit(1)})'
published=$(dc port ingress 8080)
test "$(curl --fail --silent --show-error --max-time 10 "http://$published/health/ready")" = ready
ingress=$(dc ps -q ingress)
frontend_ip=$(docker inspect --format "{{(index .NetworkSettings.Networks \"${project}_frontend\").IPAddress}}" "$ingress")
dc exec -T ingress wget -q -O /dev/null "http://$frontend_ip:8080/health/ready"
dc exec -T app bun tests/network.ts "$frontend_ip"
dc exec -T app bun tests/health.ts ready
dc exec -T app bun tests/identity.ts seed < "$auth_directory/login.txt" > "$auth_directory/session.json"
dc exec -T app bun tests/files.ts < "$auth_directory/session.json"
dc exec -T app bun tests/skills.ts < "$auth_directory/session.json"
dc exec -T app bun tests/apps.ts seed < "$auth_directory/session.json"
dc exec -T app bun tests/foundation.ts seed
# The worker may reach only the egress proxy, which refuses every destination for it.
dc exec -T -e HTTPS_PROXY=http://172.30.84.2:3128 opencode-worker bun tests/egress.ts
# Keep nginx alive while forcing a genuinely different app IP, rather than
# mistaking an all-service restart for proof of upstream DNS refresh.
old_app_ip=$(docker inspect --format "{{(index .NetworkSettings.Networks \"${project}_backend\").IPAddress}}" "$(dc ps -q app)")
ingress_image=$(docker inspect --format '{{.Image}}' "$ingress")
dc stop app
dc rm -f app
# Keep the name absent beyond nginx's five-second DNS cache lifetime. Immediate
# replacement can miss DNS failure recovery and pass while ingress stays stale
# after a longer outage. This is an outage stimulus, not a readiness wait.
sleep 8
docker run -d --name "$project-ip-holder" --network "${project}_backend" \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --entrypoint tail "$ingress_image" -f /dev/null >/dev/null
dc up -d --wait --wait-timeout 120 app
new_app_ip=$(docker inspect --format "{{(index .NetworkSettings.Networks \"${project}_backend\").IPAddress}}" "$(dc ps -q app)")
test "$old_app_ip" != "$new_app_ip"
test "$ingress" = "$(dc ps -q ingress)"
# Allow nginx's five-second DNS cache to refresh; retry only this readiness read.
test "$(curl --fail --silent --show-error --max-time 3 --retry 10 --retry-delay 1 "http://$published/health/ready")" = ready
docker rm -f "$project-ip-holder" >/dev/null
old_app=$(dc ps -q app)
old_db=$(dc ps -q postgres)
dc up -d --force-recreate --wait --wait-timeout 120
published=$(dc port ingress 8080)
test "$(curl --fail --silent --show-error --max-time 10 "http://$published/health/ready")" = ready
test "$old_app" != "$(dc ps -q app)"
test "$old_db" != "$(dc ps -q postgres)"
# Before the identity check, which ends the shared session.
dc exec -T app bun tests/apps.ts verify < "$auth_directory/session.json"
dc exec -T app bun tests/identity.ts verify < "$auth_directory/session.json"
dc exec -T app bun tests/foundation.ts verify
dc stop postgres
dc exec -T app bun tests/health.ts database-down
dc up -d --wait --wait-timeout 120
dc exec -T app bun tests/health.ts ready
app=$(dc ps -q app)
dc stop app
test "$(docker inspect --format '{{.State.ExitCode}}' "$app")" = 0
printf 'Foundation smoke passed: container replacement, retained Postgres and workspace, ingress DNS recovery, worker egress denial, health, and SIGTERM.\n'
