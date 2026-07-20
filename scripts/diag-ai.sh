#!/usr/bin/env bash
# Диагностика ИИ-подсистем: почему сотрудник считается посетителем и почему
# молчит VLM. Read-only, безопасно. Запускать НА СЕРВЕРЕ из корня репозитория:
#   ./scripts/diag-ai.sh
set +e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod"

[ -f infra/.env.prod ] || { echo "Не найден infra/.env.prod"; exit 1; }
set -a; source infra/.env.prod; set +a

line() { printf '\n========== %s ==========\n' "$1"; }
redis_() { $COMPOSE exec -T redis redis-cli "$@"; }

# ---------------------------------------------------------------------------
line "1. Face-модели в контейнере analyzer (главный подозреваемый)"
$COMPOSE exec -T analyzer sh -c 'ls -la /opt/models/ 2>/dev/null'
echo "ВАЖНО: face_detection_yunet.onnx должен быть ~230КБ, face_recognition_sface.onnx ~37МБ."
echo "Если файлов нет или размер ~130 байт (git-lfs заглушка) — распознавание по лицу"
echo "МОЛЧА выключено, сотрудник опознаётся только по одежде (порог 0.90 — часто мимо)."

line "2. Логи analyzer: face/reid (последние 300 строк)"
$COMPOSE logs --tail 300 analyzer 2>&1 | grep -iE "face|reid|staff|absorbed|enroll" | tail -30
echo "(ищем: 'face models not found' = модели не скачались при сборке;"
echo " 'face enroll ... no usable face' = фото не распозналось; 'absorbed' = поглощение работает)"

line "3. Эталоны сотрудников в Redis"
echo "--- reid:staff:$TENANT_ID (одежда):"
for gid in $(redis_ HKEYS "reid:staff:$TENANT_ID"); do
  payload="$(redis_ HGET "reid:staff:$TENANT_ID" "$gid")"
  embs=$(echo "$payload" | grep -o '"embs"' | wc -l)
  name=$(echo "$payload" | sed -n 's/.*"name": *"\([^"]*\)".*/\1/p')
  echo "  $gid  name=$name  (payload ${#payload} байт)"
done
echo "--- face:staff:$TENANT_ID (лицо: photos=загружено, failed=не распознано):"
for gid in $(redis_ HKEYS "face:staff:$TENANT_ID"); do
  payload="$(redis_ HGET "face:staff:$TENANT_ID" "$gid")"
  echo "  $gid  $(echo "$payload" | sed 's/"embs": *\[\[[^]]*\]*\]/"embs":[...]/g' | cut -c1-160)"
done
echo "--- reid:staff_auto:$TENANT_ID (автозаученная одежда за сегодня):"
redis_ HKEYS "reid:staff_auto:$TENANT_ID"
echo "--- очередь face_enroll (должна быть пустой; если растёт — analyzer её не разбирает):"
redis_ LLEN "face_enroll:$TENANT_ID"

line "4. Конфиг фичи reid (пороги)"
redis_ GET "features:$TENANT_ID" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('reid'), ensure_ascii=False, indent=2)); print('vlm:', json.dumps(d.get('vlm'), ensure_ascii=False))" 2>/dev/null \
  || redis_ GET "features:$TENANT_ID"

line "5. Счётчик посетителей и поглощённые фантомы"
redis_ HGETALL "visitors:$TENANT_ID"
for key in $(redis_ --scan --pattern 'absorbed:*'); do
  echo "$key: $(redis_ SCARD "$key") поглощено"
done

# ---------------------------------------------------------------------------
line "6. VLM: контейнеры ollama и worker-ai"
$COMPOSE ps ollama worker-ai 2>&1
echo "--- модели в ollama (нужна qwen3-vl:4b; пусто = ollama pull не делали):"
$COMPOSE exec -T ollama ollama list 2>&1
echo "--- тест генерации (короткий, без картинки):"
$COMPOSE exec -T ollama sh -c 'ollama run qwen3-vl:4b "Ответь одним словом: работаешь?" 2>&1 | head -3'

line "7. Логи worker-ai (описания/верификация/ошибки)"
$COMPOSE logs --tail 100 worker-ai 2>&1 | tail -30
echo "(ищем: 'described' = описания пишутся; 'vlm step failed' = причина отказа;"
echo " 'alert suppressed by vlm' = верификация подавила спам; пусто = воркер не собран/не запущен)"

line "8. Итоговая подсказка"
cat <<'EOF'
Сотрудник считается посетителем — по п.1-4:
  A. В п.1 нет face-моделей -> пересобрать analyzer С ИНТЕРНЕТОМ:
       docker compose ... build --no-cache analyzer && docker compose ... up -d analyzer
  B. В п.3 у сотрудника failed > 0, embs пусто -> фото не годятся: нужен
     чёткий анфас при свете, лицо крупно (селфи-план), формат JPEG/PNG
  C. Дубли одного человека в «Сотрудниках» -> оставить одну карточку,
     остальные удалить (или добавить к существующему кнопкой «+»)
  D. Пороги в п.4: staff_threshold 0.90 можно опустить до 0.85,
     face_min_px 100 -> 80 если человек в кадре мелкий
Счётчик за сегодня пересчитается сам в течение минуты после деплоя фикса
(поглощённые фантомы и сотрудники вычитаются задним числом).

VLM молчит — по п.6-7:
  E. ollama нет в списке контейнеров -> docker compose ... up -d ollama
  F. 'ollama list' пуст -> docker compose ... exec ollama ollama pull qwen3-vl:4b
  G. в п.6 тест ругается на модель/версию -> пришли вывод (возможно, образ
     ollama старый и не знает qwen3-vl — обновим тег)
  H. worker-ai отсутствует/падает -> up -d --build worker-ai, пришли логи
EOF
