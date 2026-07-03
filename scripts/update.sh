#!/usr/bin/env bash
# Rolling update without touching the datastores.
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*" >&2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE="docker compose -f infra/docker-compose.dev.yml --env-file infra/.env"

wait_api() {
  local cid; cid="$($COMPOSE ps -q api)"
  for i in $(seq 1 60); do
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
info "Building api web analyzer"
$COMPOSE build api web analyzer

# 3-5. rolling restart (datastores untouched) --------------------------------
info "Restarting api"
$COMPOSE up -d --no-deps api
wait_api || exit 1

info "Restarting web"
$COMPOSE up -d --no-deps web

info "Restarting analyzer"
$COMPOSE up -d --no-deps analyzer

# 6. safe migrations ---------------------------------------------------------
info "Running migrations"
$COMPOSE exec -T api npm run migrate

# 7. status ------------------------------------------------------------------
$COMPOSE ps
info "Update complete"
