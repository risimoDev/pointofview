#!/usr/bin/env bash
# Diagnostic dump for the camera video pipeline (go2rtc MJPEG → nginx → браузер).
# Read-only, безопасно запускать на prod-сервере. Отправь весь вывод обратно.
# Usage: ./scripts/diag-stream.sh            (из корня репозитория)
set +e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod"
GO2RTC="http://localhost:1984"

line() { printf '\n========== %s ==========\n' "$1"; }

# JSON helper: python3 есть на Ubuntu 24.04; jq может не быть.
pyjson() { python3 -c "$1" 2>/dev/null; }

# ---------------------------------------------------------------------------
line "0. git: подтянут ли фикс (#video=mjpeg)?"
git log -1 --oneline
git status --short
printf 'В registerGo2rtc сейчас: '
grep -n 'video=mjpeg\|video=h264#input=file\|ffmpeg:\${src}' api/src/routes/cameras.ts | head -3

line "1. locations.inc НА ДИСКЕ: /go2rtc/ с proxy_buffering off?"
grep -n -A12 'location /go2rtc/' infra/nginx/locations.inc

line "2. Контейнеры (нужен go2rtc + api + web + nginx)"
$COMPOSE ps

line "3. Версия go2rtc"
curl -s --max-time 5 "$GO2RTC/api" | pyjson 'import sys,json;d=json.load(sys.stdin);print("version:",d.get("version"));print("config_path:",d.get("config_path"))'
echo "---"
$COMPOSE logs --tail 3 go2rtc 2>&1 | head -5

line "4. ВСЕ потоки, зарегистрированные в go2rtc (GET /api/streams)"
STREAMS_JSON="$(curl -s --max-time 5 "$GO2RTC/api/streams")"
echo "$STREAMS_JSON" | pyjson 'import sys,json
d=json.load(sys.stdin)
if not d:
    print("!!! НЕТ НИ ОДНОГО ПОТОКА — go2rtc не получил ни одной камеры (registerGo2rtc не отработал)")
for name,info in d.items():
    print("STREAM:", name)
    for p in info.get("producers",[]):
        print("   producer.url:", p.get("url"))
        for m in p.get("medias",[]) or []:
            print("      media:", m)
    print("   consumers:", len(info.get("consumers",[]) or []))'

# Список имён потоков для дальнейших тестов
NAMES="$(echo "$STREAMS_JSON" | pyjson 'import sys,json;print("\n".join(json.load(sys.stdin).keys()))')"
if [ -z "$NAMES" ]; then
  echo "Потоков нет — дальнейшие тесты пропускаю. Проверь, что видео загружено и api смог достучаться до go2rtc."
fi

# ---------------------------------------------------------------------------
for NAME in $NAMES; do
  line "5. Поток '$NAME' — детали кодеков (есть ли mjpeg-трек?)"
  curl -s --max-time 8 "$GO2RTC/api/streams?src=$NAME" | pyjson 'import sys,json
d=json.load(sys.stdin)
prod=d.get("producers",[]) or []
cons=d.get("consumers",[]) or []
codecs=set()
for grp in (prod+cons):
    for m in grp.get("medias",[]) or []:
        codecs.add(str(m))
print("медиа/кодеки, которые go2rtc реально поднял:")
for c in sorted(codecs): print("   ", c)
if not any("MJPEG" in c.upper() or "JPEG" in c.upper() for c in codecs):
    print("   !!! MJPEG-трека НЕТ — stream.mjpeg работать не будет")'

  line "6. Поток '$NAME' — SNAPSHOT (frame.jpeg). Это то, что работает в редакторе зон"
  curl -s --max-time 10 -o /tmp/diag_frame.jpg \
    -w 'http_code=%{http_code} type=%{content_type} bytes=%{size_download}\n' \
    "$GO2RTC/api/frame.jpeg?src=$NAME"

  line "7. Поток '$NAME' — LIVE MJPEG напрямую с go2rtc (:1984). Это то, что НЕ работает"
  curl -s --max-time 8 -o /tmp/diag_mjpeg.bin \
    -w 'http_code=%{http_code} type=%{content_type} bytes=%{size_download}\n' \
    "$GO2RTC/api/stream.mjpeg?src=$NAME"
  echo "   (bytes должно быть много и type=multipart/x-mixed-replace; 0 байт = mjpeg не отдаётся)"

  line "8. Поток '$NAME' — LIVE MJPEG ЧЕРЕЗ nginx (как ходит браузер: /go2rtc/...)"
  curl -s --max-time 8 -o /tmp/diag_mjpeg_nginx.bin \
    -w 'http_code=%{http_code} type=%{content_type} bytes=%{size_download}\n' \
    "http://localhost/go2rtc/api/stream.mjpeg?src=$NAME"
done

# ---------------------------------------------------------------------------
line "9. go2rtc логи (последние 60 строк — ищем ошибки ffmpeg/exec)"
$COMPOSE logs --tail 60 go2rtc 2>&1 | grep -iE 'error|fail|exec|ffmpeg|mjpeg|panic|codec' | tail -40
echo "--- если пусто, полный хвост: ---"
$COMPOSE logs --tail 25 go2rtc 2>&1 | tail -25

line "10. Тестовое видео на диске + кодек (ffprobe внутри go2rtc-контейнера)"
$COMPOSE exec -T go2rtc sh -c 'ls -la /data 2>&1; echo "---"; for f in /data/*.mp4 /data/*.mkv /data/*.webm; do [ -f "$f" ] && ffprobe -v error -show_entries stream=codec_type,codec_name,width,height -of default=nw=1 "$f" && echo "^^ $f"; done' 2>&1 | head -40

line "11. Ручной тест: может ли ffmpeg в контейнере go2rtc сделать mjpeg из файла?"
$COMPOSE exec -T go2rtc sh -c 'f=$(ls /data/*.mp4 /data/*.mkv /data/*.webm 2>/dev/null | head -1); echo "файл: $f"; [ -n "$f" ] && ffmpeg -hide_banner -loglevel error -i "$f" -frames:v 3 -c:v mjpeg -f mjpeg /dev/null && echo "OK: ffmpeg умеет mjpeg из этого файла" || echo "FAIL: ffmpeg не смог"' 2>&1 | head -20

line "ГОТОВО"
echo "Отправь весь вывод целиком."
