#!/usr/bin/env bash
# Сборка ОФЛАЙН-ПОСТАВКИ для изолированной сети (завод, on-premise):
# все docker-образы + конфиги + миграции + install-offline.sh в одном архиве.
# Запускать на машине С ИНТЕРНЕТОМ и docker'ом (dev-ПК/сервер сборки, Linux/WSL):
#   ./scripts/offline-bundle.sh [выходной_каталог]
# Результат: viziai-offline-YYYYMMDD.tar.gz (~несколько ГБ).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OUT_DIR="${1:-./dist-offline}"
STAMP="$(date +%Y%m%d)"
BUNDLE="$OUT_DIR/viziai-offline-$STAMP"
COMPOSE_FILE="infra/docker-compose.prod.yml"
# env нужен compose только для подстановок; секреты в образы не попадают
ENV_FILE="infra/.env.prod"
[ -f "$ENV_FILE" ] || ENV_FILE="infra/.env.prod.example"

rm -rf "$BUNDLE"
mkdir -p "$BUNDLE"

echo "— 1/4: сборка образов (analyzer печёт модели — нужен интернет)…"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build

echo "— 2/4: выгрузка образов в images.tar.gz…"
IMAGES="$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config --images | sort -u)"
echo "$IMAGES" | tr '\n' ' '
# shellcheck disable=SC2086
docker save $IMAGES | gzip > "$BUNDLE/images.tar.gz"

echo "— 3/4: конфиги, миграции, скрипты…"
mkdir -p "$BUNDLE/repo"
cp -r infra scripts docs/OFFLINE-INSTALL.md "$BUNDLE/repo/" 2>/dev/null || true
rm -f "$BUNDLE/repo/infra/.env.prod"   # секреты в поставку не кладём

cat > "$BUNDLE/install-offline.sh" <<'EOF'
#!/usr/bin/env bash
# Установка ViziAI на сервере БЕЗ интернета. Требуется: docker + docker compose.
# Порядок: настроить repo/infra/.env.prod → ./install-offline.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

[ -f repo/infra/.env.prod ] || {
  cp repo/infra/.env.prod.example repo/infra/.env.prod
  echo "Создан repo/infra/.env.prod из примера — ЗАПОЛНИ его (пароли, DATA_ROOT,"
  echo "DEPLOYMENT_MODE=on-premise, YOLO_MODEL=/opt/models/yolov8s.pt) и запусти снова."
  exit 1
}

echo "— Загрузка образов (долго)…"
gunzip -c images.tar.gz | docker load

cd repo
COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod"
set -a; source infra/.env.prod; set +a

echo "— Старт инфраструктуры…"
$COMPOSE up -d postgres redis minio go2rtc
sleep 10

echo "— Миграции…"
for f in infra/postgres/migrations/*.sql; do
  echo "  $f"
  $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$f"
done

echo "— Старт всех сервисов…"
$COMPOSE up -d

echo "Готово. Проверка: docker compose ps; http://<этот-сервер>/ в браузере."
echo "Не забудь: sudo ./scripts/install-backup-cron.sh (бэкапы)."
EOF
chmod +x "$BUNDLE/install-offline.sh"

echo "— 4/4: итоговый архив…"
tar -C "$OUT_DIR" -czf "$OUT_DIR/viziai-offline-$STAMP.tar.gz" "viziai-offline-$STAMP"
du -h "$OUT_DIR/viziai-offline-$STAMP.tar.gz"
echo "Готово: $OUT_DIR/viziai-offline-$STAMP.tar.gz — перенести на целевой сервер,"
echo "распаковать, настроить repo/infra/.env.prod, запустить ./install-offline.sh"
