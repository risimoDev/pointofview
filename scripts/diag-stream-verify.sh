#!/usr/bin/env bash
# Проверка ПОСЛЕ деплоя: боевые камеры реально отдают MJPEG в дашборд.
# Read-only. Usage: ./scripts/diag-stream-verify.sh
set +e
GO2RTC="http://localhost:1984"
line() { printf '\n========== %s ==========\n' "$1"; }
pyjson() { python3 -c "$1" 2>/dev/null; }

line "Потоки go2rtc и их источники (у каждого должен быть ffmpeg:<id>#video=mjpeg)"
curl -s --max-time 5 "$GO2RTC/api/streams" | pyjson '
import sys,json
d=json.load(sys.stdin)
if not d: print("НЕТ ПОТОКОВ — reconciler ещё не отработал или go2rtc пуст"); sys.exit()
for name,info in d.items():
    urls=[p.get("url") for p in (info.get("producers",[]) or [])]
    has=any(str(u).endswith("#video=mjpeg") for u in urls)
    print(("OK  " if has else "БЕЗ MJPEG ")+name)
    for u in urls: print("      ", u)'

NAMES="$(curl -s --max-time 5 "$GO2RTC/api/streams" | pyjson 'import sys,json;print("\n".join(json.load(sys.stdin).keys()))')"

for NAME in $NAMES; do
  line "Камера $NAME — живой MJPEG (как в браузере, через nginx)"
  curl -s --max-time 6 -o /dev/null \
    -w '   /go2rtc: http=%{http_code} type=%{content_type} bytes=%{size_download}\n' \
    "http://localhost/go2rtc/api/stream.mjpeg?src=$NAME"
  echo "   (bytes > 0 и type=multipart/x-mixed-replace => дашборд работает)"
done

line "Свежие ошибки mjpeg в логах go2rtc (должно быть пусто)"
docker logs --tail 40 viziai-go2rtc-1 2>&1 | grep -i 'codecs not matched\|error' | tail -10 || echo "чисто"
