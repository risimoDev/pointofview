#!/usr/bin/env bash
# One-time project initialization after cloning the repo.
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*" >&2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="infra/docker-compose.dev.yml"
ENV_FILE="infra/.env"
PROJECT="viziai-dev"
COMPOSE="docker compose -f $COMPOSE_FILE --env-file $ENV_FILE"

DOMAIN=""; EMAIL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email)  EMAIL="$2"; shift 2 ;;
    *) err "Unknown arg: $1"; exit 1 ;;
  esac
done

# 1. install.sh prerequisite -------------------------------------------------
command -v docker >/dev/null 2>&1 || { err "Docker not found. Run scripts/install.sh first"; exit 1; }

# 2. .env --------------------------------------------------------------------
if [[ ! -f "$ENV_FILE" ]]; then
  info "Creating $ENV_FILE from example"
  cp infra/.env.example "$ENV_FILE"
  warn "Fill in $ENV_FILE (passwords, JWT_SECRET, INTERNAL_TOKEN, TENANT_ID, TELEGRAM_BOT_TOKEN)"
  read -rp "Press Enter once $ENV_FILE is ready..."
else
  info "$ENV_FILE already exists"
fi
set -a; source "$ENV_FILE"; set +a

# 3. pull images -------------------------------------------------------------
info "Pulling base images"
$COMPOSE pull

# 4. bring up DB + redis, wait for postgres ----------------------------------
info "Starting postgres + redis"
$COMPOSE up -d postgres redis

info "Waiting for postgres healthcheck (timeout 30s)"
for i in $(seq 1 30); do
  if $COMPOSE exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
    info "postgres ready"; break
  fi
  [[ $i -eq 30 ]] && { err "postgres not ready in time"; $COMPOSE logs --tail 50 postgres; exit 1; }
  sleep 1
done

# 5. migrations --------------------------------------------------------------
info "Running database migrations"
$COMPOSE run --rm api npm run migrate

# 6. MinIO buckets via mc ----------------------------------------------------
info "Creating MinIO buckets (clips, snapshots)"
$COMPOSE up -d minio
sleep 3
docker run --rm --network "${PROJECT}_default" --entrypoint sh minio/mc -c "
  mc alias set local http://minio:9000 '${MINIO_ROOT_USER}' '${MINIO_ROOT_PASSWORD}' &&
  mc mb local/${MINIO_BUCKET_CLIPS:-clips} local/${MINIO_BUCKET_SNAPSHOTS:-snapshots} --ignore-existing
"

# 7. YOLO weights (cached in analyzer volume) --------------------------------
info "Downloading YOLOv8 weights"
$COMPOSE run --rm analyzer python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

# 8. SSL via certbot (optional) ----------------------------------------------
if [[ -n "$DOMAIN" ]]; then
  info "Obtaining SSL certificate for $DOMAIN"
  command -v certbot >/dev/null 2>&1 || { apt-get update -y && apt-get install -y certbot; }
  certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos -m "${EMAIL:-admin@$DOMAIN}"
  mkdir -p infra/nginx/ssl
  cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" infra/nginx/ssl/cert.pem
  cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem"   infra/nginx/ssl/key.pem
  info "Certificates copied to infra/nginx/ssl/"
fi

echo
info "Init complete. Run ./scripts/deploy.sh to start"
