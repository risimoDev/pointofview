#!/usr/bin/env bash
# Диагностика «все камеры не в сети» после деплоя. Read-only, безопасно.
# Статус камеры = наличие ключа camera_alive:{id} в Redis (TTL 15с,
# обновляет analyzer на каждом кадре) — если анализатор не работает или не
# видит GPU, ключи истекают и ВСЕ камеры разом становятся «не в сети»,
# даже если сама трансляция жива.
# Запускать НА ДОМАШНЕМ СЕРВЕРЕ из корня репозитория:
#   ./scripts/diag-cameras-offline.sh
set +e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod"

[ -f infra/.env.prod ] || { echo "Не найден infra/.env.prod — запускай из корня репозитория."; exit 1; }
set -a; source infra/.env.prod; set +a

line() { printf '\n========== %s ==========\n' "$1"; }

# ---------------------------------------------------------------------------
line "1. Состояние контейнеров (analyzer/api/redis/ollama)"
$COMPOSE ps analyzer api redis ollama worker-ai 2>&1

# ---------------------------------------------------------------------------
line "2. Логи analyzer — последние 150 строк (тут обычно и есть причина)"
$COMPOSE logs --tail 150 analyzer 2>&1

# ---------------------------------------------------------------------------
line "3. Analyzer падал/рестартовал? (RestartCount, время старта)"
CID="$($COMPOSE ps -q analyzer)"
if [ -n "$CID" ]; then
  docker inspect "$CID" --format 'Status={{.State.Status}} Running={{.State.Running}} RestartCount={{.RestartCount}} StartedAt={{.State.StartedAt}} Error={{.State.Error}}'
else
  echo "Контейнер analyzer не найден (не запущен?)"
fi

# ---------------------------------------------------------------------------
line "4. GPU: память и процессы (конкурирует ли ollama с analyzer за VRAM)"
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free --format=csv
  echo "--- процессы на GPU:"
  nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv
else
  echo "nvidia-smi недоступен на хосте — если сервер сам без GPU-драйвера в PATH, это нормально."
fi

# ---------------------------------------------------------------------------
line "5. Redis: heartbeat-ключи камер"
ALIVE_COUNT="$($COMPOSE exec -T redis redis-cli --scan --pattern 'camera_alive:*' | wc -l)"
echo "Живых heartbeat-ключей camera_alive:*: $ALIVE_COUNT (0 = анализатор не пишет вообще ни для одной камеры)"
TENANT_ID="${TENANT_ID:-}"
if [ -n "$TENANT_ID" ]; then
  echo "--- cameras:{tenant} (список камер, который видит analyzer):"
  $COMPOSE exec -T redis redis-cli STRLEN "cameras:$TENANT_ID"
fi

# ---------------------------------------------------------------------------
line "6. Логи api — ошибки за последние 10 минут"
$COMPOSE logs --since 10m api 2>&1 | grep -iE "error|fatal|exception" | tail -30
echo "(пусто — ошибок в api не было)"

# ---------------------------------------------------------------------------
line "7. Итоговая подсказка"
cat <<'EOF'
Типовые причины и что искать в п.2:
  A. "CUDA out of memory" / "CUDA error"  -> видеокарте не хватило VRAM
     (ollama + модели плагинов вместе). Смотри п.4: если ollama держит
     несколько ГБ, а analyzer не стартует — временно останови ollama:
       docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod stop ollama
     и перезапусти analyzer:
       docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod restart analyzer
  B. Traceback / ModuleNotFoundError / ImportError сразу после старта
     -> проблема сборки образа, пришли эти строки целиком.
  C. Контейнер analyzer вообще не в списке (п.1) или Status != running
     -> не поднялся при деплое, пробуй:
       docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d analyzer
  D. Контейнер Up, RestartCount растёт, но в логах тихо/крутится по кругу
     -> зацикленный краш, нужны полные логи (без --tail):
       docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod logs analyzer > analyzer-full.log
  E. Контейнер Up, героика в п.2 не видна, но camera_alive:* = 0 в п.5
     -> analyzer жив, но не может подключиться к камерам (сеть/RTSP) —
        это другая проблема, не про этот деплой; используй scripts/diag-camera.sh
EOF
