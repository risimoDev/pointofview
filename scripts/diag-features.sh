#!/usr/bin/env bash
# Диагностика фич/плагинов анализатора (pose, ppe и остальных):
# вся цепочка БД → Redis → analyzer. Read-only, безопасно.
# Запускать НА ДОМАШНЕМ СЕРВЕРЕ из корня репозитория:
#   ./scripts/diag-features.sh
set +e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod"

[ -f infra/.env.prod ] || { echo "Не найден infra/.env.prod — запускай из корня репозитория."; exit 1; }
set -a; source infra/.env.prod; set +a

line() { printf '\n========== %s ==========\n' "$1"; }
psql_() { $COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F'|' -c "$1"; }
redis_() { $COMPOSE exec -T redis redis-cli "$@"; }

# ---------------------------------------------------------------------------
line "1. Миграция 0006: enum-значения в БД"
echo "feature_kind: $(psql_ "select enum_range(null::feature_kind);")"
echo "event_type:   $(psql_ "select enum_range(null::event_type);")"
psql_ "select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
       where t.typname='feature_kind' and e.enumlabel='pose';" | grep -q 1 \
  && echo "OK: 'pose' есть в feature_kind" \
  || echo "ПРОБЛЕМА: 'pose' НЕТ в feature_kind — миграция 0006 не применилась. Прогони scripts/update.sh или вручную: ALTER TYPE feature_kind ADD VALUE IF NOT EXISTS 'pose';"

# ---------------------------------------------------------------------------
line "2. tenant_feature в БД (что сохранила админка)"
psql_ "select t.name, f.feature, f.enabled, f.config
       from tenant_feature f join tenant t on t.id = f.tenant_id
       order by t.name, f.feature;"

# ---------------------------------------------------------------------------
line "3. Redis: features / plugin_status / analyzer_metrics по тенантам"
for TID in $(psql_ "select id from tenant;"); do
  echo "--- tenant $TID"
  echo "features:        $(redis_ GET "features:$TID")"
  echo "plugin_status:   $(redis_ GET "plugin_status:$TID")"
  echo "analyzer_metrics:$(redis_ GET "analyzer_metrics:$TID")"
done
echo
echo "Если plugin_status пуст — анализатор старой сборки или не тикнул (ключ живёт 120с)."

# ---------------------------------------------------------------------------
line "4. Analyzer: контейнер, модель позы, версии"
$COMPOSE ps analyzer
echo "--- ultralytics в контейнере:"
$COMPOSE exec -T analyzer python -c "import ultralytics; print(ultralytics.__version__)" 2>&1
echo "--- POSE_MODEL и файл:"
$COMPOSE exec -T analyzer sh -c 'echo "POSE_MODEL=$POSE_MODEL"; ls -la /opt/models/ 2>/dev/null'
echo "--- /models (веса СИЗ, ppe.pt):"
$COMPOSE exec -T analyzer sh -c 'ls -la /models/ 2>/dev/null || echo "/models не смонтирован или пуст"'

# ---------------------------------------------------------------------------
line "5. Логи analyzer: плагины/pose/ppe (последние 200 строк)"
$COMPOSE logs --tail 200 analyzer 2>&1 | grep -iE "plugin|pose|ppe|setup|vram|error|traceback" | tail -40
echo "(пусто = плагины не упоминались — вероятно, старый образ без нового кода)"

# ---------------------------------------------------------------------------
line "6. Логи api: ошибки на PUT /features (последние 200 строк)"
$COMPOSE logs --tail 200 api 2>&1 | grep -iE "features|400|500" | tail -20

# ---------------------------------------------------------------------------
line "7. Итоговая подсказка"
cat <<'EOF'
Типовые причины «фича не включается»:
  A. В п.1 нет 'pose'            -> миграция: scripts/update.sh
  B. В п.2 нет строки pose       -> админка не сохранила: жми «Сохранить», смотри п.6
  C. В п.3 features есть, plugin_status пуст/без pose -> analyzer старой сборки:
       docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build analyzer
  D. В п.3 pose со state=error   -> текст ошибки там же (нет файла модели и т.п.), см. п.4
  E. В п.3 pose state=vram_exceeded -> поднять VRAM_BUDGET_MB или выключить другую модель
EOF
