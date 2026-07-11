#!/usr/bin/env bash
# Полная диагностика ОДНОЙ камеры: что именно не работает и почему.
# Read-only, безопасно запускать. Запускать НА ДОМАШНЕМ СЕРВЕРЕ (viziai-server).
# Usage: ./scripts/diag-camera.sh <часть имени или ID камеры>
#   ./scripts/diag-camera.sh "Точка на Ленина"
#   ./scripts/diag-camera.sh a557df67
set +e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod"
GO2RTC="http://localhost:1984"

QUERY="${1:-}"
[ -n "$QUERY" ] || { echo "Usage: $0 <имя или ID камеры (можно часть)>"; exit 1; }

[ -f infra/.env.prod ] || { echo "Не найден infra/.env.prod — запускай из корня репозитория."; exit 1; }
set -a; source infra/.env.prod; set +a

line() { printf '\n========== %s ==========\n' "$1"; }
psql_() { $COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F'|' -c "$1"; }

# ---------------------------------------------------------------------------
line "1. Камера в базе данных"
ROW="$(psql_ "select c.id, c.name, c.source_type, c.status, c.url_main, c.url_sub, s.tenant_id
              from camera c join site s on s.id = c.site_id
              where c.name ilike '%${QUERY}%' or c.id::text ilike '%${QUERY}%'
              limit 1;")"

if [ -z "$ROW" ]; then
  echo "НЕ НАЙДЕНА камера по запросу '$QUERY'. Проверь имя/ID в админке (Камеры)."
  exit 1
fi

CAM_ID="$(echo "$ROW" | cut -d'|' -f1)"
CAM_NAME="$(echo "$ROW" | cut -d'|' -f2)"
SRC_TYPE="$(echo "$ROW" | cut -d'|' -f3)"
DB_STATUS="$(echo "$ROW" | cut -d'|' -f4)"
URL_MAIN="$(echo "$ROW" | cut -d'|' -f5)"
URL_SUB="$(echo "$ROW" | cut -d'|' -f6)"
TENANT_ID="$(echo "$ROW" | cut -d'|' -f7)"

echo "id:          $CAM_ID"
echo "имя:         $CAM_NAME"
echo "тип:         $SRC_TYPE"
echo "статус в БД: $DB_STATUS   (только ручной override 'error'; online/offline считает heartbeat, см. ниже)"
echo "url_main:    $URL_MAIN"
echo "url_sub:     $URL_SUB"
echo "tenant_id:   $TENANT_ID"

# analyzer использует url_sub, а если его нет — url_main (analyzer/config.py: ai_url())
AI_URL="${URL_SUB:-$URL_MAIN}"
if [ -z "$AI_URL" ] || [ "$AI_URL" = "" ]; then
  echo ""
  echo "!!! У камеры не задан ни url_main, ни url_sub — анализатору нечего читать."
  echo "    Открой камеру в админке и заполни 'Доп. URL (ИИ-анализ)'."
  exit 1
fi
echo ""
echo "URL, который реально использует анализатор: $AI_URL"

# ---------------------------------------------------------------------------
line "2. Heartbeat анализатора в Redis (от него зависит бейдж В СЕТИ/НЕ В СЕТИ)"
TTL="$($COMPOSE exec -T redis redis-cli TTL "camera_alive:${CAM_ID}" 2>/dev/null | tr -d '\r')"
if [ "$TTL" != "-2" ] && [ -n "$TTL" ]; then
  echo "ЕСТЬ heartbeat, осталось ${TTL}с (TTL 15с, обновляется раз в 5с) — анализатор РЕАЛЬНО читает кадры."
else
  echo "НЕТ heartbeat — анализатор либо не запустил эту камеру, либо не может прочитать поток."
fi

line "3. Список камер, который видит анализатор (Redis cameras:{tenant})"
CAMS_JSON="$($COMPOSE exec -T redis redis-cli GET "cameras:${TENANT_ID}" 2>/dev/null)"
if echo "$CAMS_JSON" | grep -q "$CAM_ID"; then
  echo "Камера ЕСТЬ в списке — API её синхронизировал в Redis (syncCameras)."
else
  echo "!!! Камеры НЕТ в cameras:${TENANT_ID} — анализатор её вообще не подхватит."
  echo "    Попробуй: Обслуживание -> Ресинхр Redis в /admin/maintenance."
fi

# ---------------------------------------------------------------------------
line "4. Регистрация в go2rtc (нужна для живого видео и снапшота/зон)"
GO2_INFO="$(curl -s --max-time 5 "$GO2RTC/api/streams?src=$CAM_ID")"
if [ -n "$GO2_INFO" ] && [ "$GO2_INFO" != "null" ] && [ "$GO2_INFO" != "{}" ]; then
  echo "$GO2_INFO" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
except Exception:
    print('(пустой ответ)'); sys.exit()
for p in d.get('producers',[]) or []:
    print('  producer.url:', p.get('url'))
print('  consumers:', len(d.get('consumers',[]) or []))
" 2>/dev/null || echo "$GO2_INFO"
else
  echo "!!! go2rtc НЕ ЗНАЕТ про эту камеру — живого видео/снапшота не будет."
  echo "    Пересохрани камеру в админке (кнопка Изменить -> Сохранить) — это дёрнет регистрацию."
fi

# ---------------------------------------------------------------------------
line "5. Сеть: доступен ли адрес камеры с сервера ($AI_URL)"
CAM_HOST="$(echo "$AI_URL" | sed -E 's#^[a-z]+://([^@]*@)?([^:/]+).*#\2#')"
CAM_PORT="$(echo "$AI_URL" | sed -nE 's#^[a-z]+://([^@]*@)?[^:/]+:([0-9]+).*#\2#p')"
CAM_PORT="${CAM_PORT:-554}"
echo "хост: $CAM_HOST   порт: $CAM_PORT"
if timeout 4 bash -c "cat < /dev/null > /dev/tcp/$CAM_HOST/$CAM_PORT" 2>/dev/null; then
  echo "OK: порт $CAM_PORT на $CAM_HOST открыт (сервер до камеры достучался)."
else
  echo "!!! НЕ ОТКРЫТ: сервер не может достучаться до $CAM_HOST:$CAM_PORT."
  if [[ "$CAM_HOST" == 10.9.0.* ]]; then
    echo "    Это адрес точки ПВЗ в туннеле. Проверь на ПК точки: ping 10.9.0.1 идёт?"
    echo "    служба AmneziaWG запущена? проброс порта (ШАГ 4/5 pvz-onboarding) активен?"
  fi
fi

# ---------------------------------------------------------------------------
line "6. Реальное открытие потока — ИЗ КОНТЕЙНЕРА analyzer (тот же путь, что у настоящего ИИ)"
if $COMPOSE ps analyzer >/dev/null 2>&1; then
  $COMPOSE exec -T analyzer ffprobe -hide_banner -rtsp_transport tcp -timeout 8000000 \
    -show_entries stream=codec_type,codec_name,width,height -of default=noprint_wrappers=1 -i "$AI_URL"
  if [ $? -eq 0 ]; then
    echo ""
    echo "ОТЛИЧНО: analyzer видит поток. Если бейдж всё ещё НЕ В СЕТИ — подожди ~30-60с"
    echo "(камеры подхватываются раз в zone_refresh_seconds) и обнови дашборд."
  else
    echo ""
    echo "ОШИБКА: analyzer не смог открыть поток по этому URL."
    echo "Проверь логин/пароль/путь ещё раз на точке (ШАГ 2 из pvz-onboarding)."
  fi
else
  echo "Контейнер analyzer не запущен — пропускаю."
fi

# ---------------------------------------------------------------------------
line "7. Свежие логи analyzer по этой камере"
$COMPOSE logs --tail 200 analyzer 2>&1 | grep -i "$CAM_ID" | tail -20 || echo "(записей не найдено)"

line "ГОТОВО — отправь весь вывод целиком"
