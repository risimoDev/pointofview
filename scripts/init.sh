#!/usr/bin/env bash
# One-time project initialization after cloning the repo.
# Mode auto-detect: prod if infra/.env.prod exists, else dev.
# Flags: --prod | --dev (force mode), --seed (apply seed.dev.sql: super user, demo tenant)
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*" >&2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE=""; DO_SEED=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prod) MODE=prod; shift ;;
    --dev)  MODE=dev;  shift ;;
    --seed) DO_SEED=1; shift ;;
    *) err "Unknown arg: $1"; exit 1 ;;
  esac
done
if [[ -z "$MODE" ]]; then
  [[ -f infra/.env.prod ]] && MODE=prod || MODE=dev
fi

if [[ "$MODE" == "prod" ]]; then
  COMPOSE_FILE="infra/docker-compose.prod.yml"; ENV_FILE="infra/.env.prod"
  ENV_EXAMPLE="infra/.env.prod.example"; PROJECT="viziai"
else
  COMPOSE_FILE="infra/docker-compose.dev.yml"; ENV_FILE="infra/.env"
  ENV_EXAMPLE="infra/.env.example"; PROJECT="viziai-dev"
fi
COMPOSE="docker compose -f $COMPOSE_FILE --env-file $ENV_FILE"
info "Mode: $MODE ($COMPOSE_FILE)"

# 1. prerequisites -------------------------------------------------------------
command -v docker >/dev/null 2>&1 || { err "Docker not found. Run sudo scripts/install.sh first"; exit 1; }

# 2. .env ------------------------------------------------------------------------
if [[ ! -f "$ENV_FILE" ]]; then
  info "Creating $ENV_FILE from $ENV_EXAMPLE"
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  warn "Fill in $ENV_FILE (domain, VPS_PUBLIC_IP, passwords, JWT_SECRET, INTERNAL_TOKEN, TENANT_ID)"
  read -rp "Press Enter once $ENV_FILE is ready..."
else
  info "$ENV_FILE already exists"
fi
set -a; source "$ENV_FILE"; set +a

# 3. build + pull ----------------------------------------------------------------
info "Building app images (first build downloads torch — takes a while)"
$COMPOSE build
info "Pulling base images"
$COMPOSE pull --ignore-buildable

# 4. bring up DB + redis, wait for postgres ---------------------------------------
info "Starting postgres + redis"
$COMPOSE up -d postgres redis

info "Waiting for postgres healthcheck (timeout 60s)"
for i in $(seq 1 60); do
  if $COMPOSE exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
    info "postgres ready"; break
  fi
  [[ $i -eq 60 ]] && { err "postgres not ready in time"; $COMPOSE logs --tail 50 postgres; exit 1; }
  sleep 1
done

# 5. migrations --------------------------------------------------------------------
info "Running database migrations"
$COMPOSE run --rm api npm run migrate

# 6. seed (optional) -----------------------------------------------------------------
if [[ $DO_SEED -eq 1 ]]; then
  info "Applying seed.dev.sql (super/admin users, demo tenant) — change passwords after login!"
  $COMPOSE exec -T postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" < infra/postgres/seed.dev.sql
fi

# 7. MinIO buckets via mc --------------------------------------------------------------
info "Creating MinIO buckets (clips, snapshots)"
$COMPOSE up -d minio
sleep 3
docker run --rm --network "${PROJECT}_default" --entrypoint sh minio/mc -c "
  mc alias set local http://minio:9000 '${MINIO_ROOT_USER}' '${MINIO_ROOT_PASSWORD}' &&
  mc mb local/${MINIO_BUCKET_CLIPS:-clips} local/${MINIO_BUCKET_SNAPSHOTS:-snapshots} --ignore-existing
"

# 8. CUDA sanity check (prod / GPU hosts) ------------------------------------------------
if [[ "$MODE" == "prod" ]]; then
  info "Checking CUDA inside analyzer container"
  if $COMPOSE run --rm analyzer python -c "import torch; assert torch.cuda.is_available(), 'CUDA not available'; print('CUDA OK:', torch.cuda.get_device_name(0))"; then
    info "GPU visible from container"
  else
    warn "CUDA not available in container — check nvidia driver + container toolkit"
  fi
fi

echo
info "Init complete. Run ./scripts/deploy.sh to start the full stack"
