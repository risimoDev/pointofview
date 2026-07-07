#!/usr/bin/env bash
# Эмпирический подбор РАБОЧЕЙ строки источника go2rtc для MJPEG из файла.
# Создаёт временные потоки diag_*, проверяет их и удаляет за собой.
# Read-only для боевых камер (их не трогает). Отправь весь вывод обратно.
# Usage: ./scripts/diag-stream2.sh
set +e

GO2RTC="http://localhost:1984"
FILE="/data/pvz.mp4"   # тестовое видео, уже лежит в go2rtc
line() { printf '\n========== %s ==========\n' "$1"; }
pyjson() { python3 -c "$1" 2>/dev/null; }

# показать какие медиа/кодеки go2rtc реально поднял для потока
show_medias() {
  curl -s --max-time 10 "$GO2RTC/api/streams?src=$1" | pyjson '
import sys,json
d=json.load(sys.stdin)
cod=set()
for grp in (d.get("producers",[]) or [])+(d.get("consumers",[]) or []):
    for m in grp.get("medias",[]) or []:
        cod.add(str(m))
print("   медиа:", sorted(cod) or "нет (producer ещё не стартовал)")
print("   HAS_JPEG:", any("JPEG" in c.upper() for c in cod))'
}

# запустить mjpeg-потребителя на 6с и сказать сколько байт пришло
test_mjpeg() {
  local n="$1"
  local out
  out=$(curl -s --max-time 6 -o /dev/null \
    -w 'http_code=%{http_code} type=%{content_type} bytes=%{size_download}' \
    "$GO2RTC/api/stream.mjpeg?src=$n")
  echo "   stream.mjpeg: $out"
}

cleanup() {
  for n in diag_two diag_mjpegonly diag_dual; do
    curl -s -o /dev/null "$GO2RTC/api/streams?src=$n" -X DELETE
  done
}

line "A. Рабочий mtest — как он устроен (учимся у него)"
curl -s --max-time 10 "$GO2RTC/api/streams?src=mtest" | pyjson '
import sys,json
d=json.load(sys.stdin)
print(json.dumps(d,ensure_ascii=False,indent=1)[:1500])'

cleanup
sleep 1

# --- Вариант 1: ДВА источника (нативный h264 + ленивый mjpeg-транскод потока) ---
line "ВАРИАНТ 1: два источника (h264 + ffmpeg:diag_two#video=mjpeg) одним PUT"
curl -s -o /dev/null -w '   PUT http=%{http_code}\n' -X PUT -G "$GO2RTC/api/streams" \
  --data-urlencode "name=diag_two" \
  --data-urlencode "src=ffmpeg:${FILE}#video=h264#input=file" \
  --data-urlencode "src=ffmpeg:diag_two#video=mjpeg"
echo "   зарегистрированные источники:"
curl -s --max-time 5 "$GO2RTC/api/streams?src=diag_two" | pyjson '
import sys,json;d=json.load(sys.stdin)
for p in d.get("producers",[]) or []: print("     -", p.get("url"))'
test_mjpeg diag_two
show_medias diag_two

# --- Вариант 2: только mjpeg из файла (один источник) ---
line "ВАРИАНТ 2: один источник — только mjpeg (ffmpeg:file#video=mjpeg#input=file)"
curl -s -o /dev/null -w '   PUT http=%{http_code}\n' -X PUT -G "$GO2RTC/api/streams" \
  --data-urlencode "name=diag_mjpegonly" \
  --data-urlencode "src=ffmpeg:${FILE}#video=mjpeg#input=file"
test_mjpeg diag_mjpegonly
show_medias diag_mjpegonly
echo "   frame.jpeg (нужен для редактора зон):"
curl -s --max-time 10 -o /dev/null -w '     http=%{http_code} type=%{content_type} bytes=%{size_download}\n' \
  "$GO2RTC/api/frame.jpeg?src=diag_mjpegonly"

# --- Вариант 3: дуал-кодек в одном процессе (повтор того, что упало с EOF) ---
line "ВАРИАНТ 3: дуал-кодек одним процессом (h264+mjpeg) — проверяем EOF"
curl -s -o /dev/null -w '   PUT http=%{http_code}\n' -X PUT -G "$GO2RTC/api/streams" \
  --data-urlencode "name=diag_dual" \
  --data-urlencode "src=ffmpeg:${FILE}#video=h264#video=mjpeg#input=file"
test_mjpeg diag_dual
show_medias diag_dual

line "Логи go2rtc по diag_* (ошибки ffmpeg/exec/EOF)"
docker logs --tail 120 viziai-go2rtc-1 2>&1 | grep -iE 'diag_|mjpeg|error|eof|exec' | tail -30

line "Убираю временные потоки"
cleanup
echo "diag_* удалены. Отправь весь вывод."
