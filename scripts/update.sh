#!/usr/bin/env bash
# Rolling update without touching the datastores (postgres/redis/minio keep running).
# Mode auto-detect: prod if infra/.env.prod exists, else dev.
# Flags: --prod | --dev
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*" >&2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prod) MODE=prod; shift ;;
    --dev)  MODE=dev;  shift ;;
    *) err "Unknown arg: $1"; exit 1 ;;
  esac
done
if [[ -z "$MODE" ]]; then
  [[ -f infra/.env.prod ]] && MODE=prod || MODE=dev
fi

if [[ "$MODE" == "prod" ]]; then
  COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod"
else
  COMPOSE="docker compose -f infra/docker-compose.dev.yml --env-file infra/.env"
fi
info "Mode: $MODE"

SERVICES="$($COMPOSE config --services)"
has() { grep -qx "$1" <<< "$SERVICES"; }

wait_api() {
  local cid; cid="$($COMPOSE ps -q api)"
  for i in $(seq 1 90); do
    local s; s="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
    case "$s" in healthy|running) info "api: $s"; return 0 ;; unhealthy|exited|dead) err "api: $s"; docker logs "$cid" --tail 50; return 1 ;; esac
    sleep 1
  done
  err "api: timeout"; return 1
}

# 1. pull --------------------------------------------------------------------
info "git pull origin main"
git pull origin main
git log -1 --oneline

# 2. build app images --------------------------------------------------------
APP_SVCS=""
for svc in api web analyzer worker-clips worker-alerts; do
  has "$svc" && APP_SVCS="$APP_SVCS $svc"
done
info "Building:$APP_SVCS"
# shellcheck disable=SC2086
$COMPOSE build $APP_SVCS

# 3. safe migrations BEFORE rollout ------------------------------------------
# Idempotent SQL files; postgres keeps running throughout the update.
info "Applying SQL migrations"
set -a; source "$([[ "$MODE" == prod ]] && echo infra/.env.prod || echo infra/.env)"; set +a
for f in infra/postgres/migrations/*.sql; do
  info "  $(basename "$f")"
  $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" < "$f"
done

# 4. rolling restart (datastores untouched) -----------------------------------
info "Restarting api"
$COMPOSE up -d --no-deps api
wait_api || exit 1

for svc in worker-clips worker-alerts web analyzer; do
  if has "$svc"; then
    info "Restarting $svc"
    $COMPOSE up -d --no-deps "$svc"
  fi
done

# api/web just got new container IPs — nginx caches upstream DNS, so it needs
# an explicit reload or it keeps talking to the old (now-dead) addresses.
if has nginx; then
  info "Reloading nginx (picks up new api/web container IPs)"
  $COMPOSE exec -T nginx nginx -t && $COMPOSE exec -T nginx nginx -s reload
fi

# 5. status --------------------------------------------------------------------
$COMPOSE ps
info "Update complete"
