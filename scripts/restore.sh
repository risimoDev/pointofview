#!/usr/bin/env bash
# Восстановление из бэкапа. ЗАМЕНЯЕТ текущие данные БД (и Redis, если передан
# rdb-файл). API и воркеры останавливаются на время восстановления.
# Usage:
#   ./scripts/restore.sh <pg-YYYYMMDD-HHMMSS.dump> [redis-YYYYMMDD-HHMMSS.rdb]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod"

PG_DUMP_FILE="${1:-}"
RDB_FILE="${2:-}"
[ -f "$PG_DUMP_FILE" ] || { echo "Usage: $0 <pg-*.dump> [redis-*.rdb]"; exit 1; }
[ -f infra/.env.prod ] || { echo "Не найден infra/.env.prod"; exit 1; }
set -a; source infra/.env.prod; set +a

echo "ВНИМАНИЕ: текущие данные PostgreSQL будут ЗАМЕНЕНЫ содержимым:"
echo "  $PG_DUMP_FILE"
[ -n "$RDB_FILE" ] && echo "  + Redis: $RDB_FILE"
read -r -p "Введи 'yes' для продолжения: " CONFIRM
[ "$CONFIRM" = "yes" ] || { echo "Отменено."; exit 1; }

echo "— Останавливаю api и воркеры…"
$COMPOSE stop api worker-clips worker-alerts analyzer

echo "— Восстанавливаю PostgreSQL…"
$COMPOSE exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --clean --if-exists --no-owner < "$PG_DUMP_FILE"

if [ -n "$RDB_FILE" ]; then
  echo "— Восстанавливаю Redis…"
  $COMPOSE stop redis
  RDB_ABS="$(cd "$(dirname "$RDB_FILE")" && pwd)/$(basename "$RDB_FILE")"
  # temp-контейнер с теми же томами кладёт rdb на место
  $COMPOSE run --rm --no-deps -v "$RDB_ABS":/restore.rdb --entrypoint sh redis \
    -c 'cp /restore.rdb /data/dump.rdb'
  $COMPOSE start redis
fi

echo "— Запускаю сервисы…"
$COMPOSE start api worker-clips worker-alerts analyzer
echo "Готово. Проверь /admin/settings (панель состояния) и дашборд."
