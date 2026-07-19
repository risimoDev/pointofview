#!/usr/bin/env bash
# Ночной бэкап: PostgreSQL (pg_dump -Fc) + Redis (SAVE → dump.rdb) в
# ${DATA_ROOT}/backups. Ротация: 7 дневных + 4 недельных (воскресных).
# MinIO (клипы/снапшоты) не бэкапится — производные данные.
# Статус пишется в Redis (ключ backup:last) → виден в /admin/settings.
#
# Запуск на сервере из корня репозитория; cron ставится скриптом
# scripts/install-backup-cron.sh. Зеркало на второй диск: BACKUP_MIRROR_DIR
# в infra/.env.prod (опционально).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod"

[ -f infra/.env.prod ] || { echo "Не найден infra/.env.prod"; exit 1; }
set -a; source infra/.env.prod; set +a

BACKUP_DIR="${BACKUP_DIR:-${DATA_ROOT}/backups}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
PG_FILE="$BACKUP_DIR/pg-$STAMP.dump"
RDB_FILE="$BACKUP_DIR/redis-$STAMP.rdb"

write_status() { # $1 = json
  echo "$1" | $COMPOSE exec -T redis redis-cli -x SET backup:last >/dev/null 2>&1 || true
}
on_error() {
  write_status "{\"ok\":false,\"ts\":$(date +%s),\"error\":\"backup failed, see /var/log/viziai-backup.log\"}"
  echo "BACKUP FAILED" >&2
}
trap on_error ERR

echo "[$(date -Is)] backup start → $BACKUP_DIR"

# 1. PostgreSQL: custom format (сжатый, восстановление pg_restore)
$COMPOSE exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$PG_FILE"
PG_BYTES=$(stat -c%s "$PG_FILE")

# 2. Redis: галереи re-id, эталоны сотрудников, настройки фич
$COMPOSE exec -T redis redis-cli SAVE >/dev/null
$COMPOSE cp redis:/data/dump.rdb "$RDB_FILE" >/dev/null
RDB_BYTES=$(stat -c%s "$RDB_FILE")

# 3. Ротация: дневные старше 7 дней удаляются, кроме воскресных младше 35
for f in "$BACKUP_DIR"/pg-*.dump "$BACKUP_DIR"/redis-*.rdb; do
  [ -e "$f" ] || continue
  AGE_DAYS=$(( ( $(date +%s) - $(stat -c%Y "$f") ) / 86400 ))
  DOW=$(date -r "$f" +%u)  # 7 = воскресенье
  if [ "$AGE_DAYS" -gt 35 ]; then rm -f "$f"; continue; fi
  if [ "$AGE_DAYS" -gt 7 ] && [ "$DOW" != "7" ]; then rm -f "$f"; fi
done

# 4. Зеркало на второй диск (если настроено)
if [ -n "${BACKUP_MIRROR_DIR:-}" ] && [ -d "${BACKUP_MIRROR_DIR:-}" ]; then
  cp -f "$PG_FILE" "$RDB_FILE" "$BACKUP_MIRROR_DIR/" || echo "WARN: зеркало недоступно"
fi

write_status "{\"ok\":true,\"ts\":$(date +%s),\"pg_file\":\"$(basename "$PG_FILE")\",\"pg_bytes\":$PG_BYTES,\"redis_bytes\":$RDB_BYTES}"
echo "[$(date -Is)] backup done: pg=$PG_BYTES bytes, redis=$RDB_BYTES bytes"
