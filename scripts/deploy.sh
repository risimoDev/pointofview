#!/usr/bin/env bash
# Start / update all services.
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*" >&2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE="docker compose -f infra/docker-compose.dev.yml --env-file infra/.env"

DO_BUILD=0; DO_PULL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) DO_BUILD=1; shift ;;
    --pull)  DO_PULL=1;  shift ;;
    *) err "Unknown flag: $1"; exit 1 ;;
  esac
done

# 1. git pull ----------------------------------------------------------------
if [[ $DO_PULL -eq 1 ]]; then
  info "git pull origin main"
  git pull origin main
  git log -1 --oneline
fi

# 2. build -------------------------------------------------------------------
if [[ $DO_BUILD -eq 1 ]]; then
  info "Building images (--no-cache)"
  $COMPOSE build --no-cache
else
  info "Building changed images"
  $COMPOSE build
fi

# 3. up ----------------------------------------------------------------------
info "Starting services"
$COMPOSE up -d --remove-orphans

# 4. healthcheck wait --------------------------------------------------------
wait_healthy() {
  local svc="$1" cid
  cid="$($COMPOSE ps -q "$svc" 2>/dev/null || true)"
  if [[ -z "$cid" ]]; then warn "$svc: no container, skipping"; return 0; fi
  for i in $(seq 1 60); do
    local status
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
    case "$status" in
      healthy|running) info "$svc: $status"; return 0 ;;
      unhealthy|exited|dead) err "$svc: $status"; docker logs "$cid" --tail 50; return 1 ;;
    esac
    sleep 1
  done
  err "$svc: timeout (60s)"; docker logs "$cid" --tail 50; return 1
}

for svc in postgres redis minio api analyzer; do
  wait_healthy "$svc" || exit 1
done

# 5. status ------------------------------------------------------------------
info "Service status:"
$COMPOSE ps

# 6. URLs --------------------------------------------------------------------
HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST="${HOST:-localhost}"
echo
info "Web : http://${HOST}:${WEB_PORT:-3001}"
info "API : http://${HOST}:${API_PORT:-3000}"
