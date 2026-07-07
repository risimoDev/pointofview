#!/usr/bin/env bash
# Проверка ПОСЛЕ деплоя новой схемы (MSE/HLS, один нативный H264-источник).
# Read-only. Usage: ./scripts/diag-stream-verify.sh
set +e
GO2RTC="http://localhost:1984"
line() { printf '\n========== %s ==========\n' "$1"; }
pyjson() { python3 -c "$1" 2>/dev/null; }

line "0. Файлы плеера отдаются web-контейнером через nginx (нужен HTTP 200 + JS)"
for p in /players/video-stream.js /players/video-rtc.js; do
  curl -s --max-time 8 -o /dev/null \
    -w "   $p: http=%{http_code} type=%{content_type} bytes=%{size_download}\n" \
    "http://localhost$p"
done
echo "   (404 => web пересобран без public/ — проверь COPY public в web/Dockerfile)"

line "1. Потоки go2rtc: у каждой камеры РОВНО ОДИН источник (нет mjpeg-хвоста)"
curl -s --max-time 5 "$GO2RTC/api/streams" | pyjson '
import sys,json
d=json.load(sys.stdin)
if not d: print("НЕТ ПОТОКОВ — reconciler ещё не отработал (подожди ~60с после старта api)"); sys.exit()
for name,info in d.items():
    urls=[p.get("url") for p in (info.get("producers",[]) or [])]
    mjpeg=[u for u in urls if str(u).endswith("#video=mjpeg")]
    flag="OK  " if (len(urls)==1 and not mjpeg) else "ПРОВЕРЬ "
    print(flag+name+"  producers="+str(len(urls)))
    for u in urls: print("      ", u)'

NAMES="$(curl -s --max-time 5 "$GO2RTC/api/streams" | pyjson 'import sys,json;print("\n".join(json.load(sys.stdin).keys()))')"

for NAME in $NAMES; do
  line "2. Камера $NAME — HLS через nginx (путь плеера для iOS)"
  curl -s --max-time 10 -o /dev/null \
    -w '   stream.m3u8: http=%{http_code} type=%{content_type} bytes=%{size_download}\n' \
    "http://localhost/go2rtc/api/stream.m3u8?src=$NAME"

  line "3. Камера $NAME — snapshot (редактор зон), должен быть image/jpeg"
  curl -s --max-time 10 -o /dev/null \
    -w '   frame.jpeg: http=%{http_code} type=%{content_type} bytes=%{size_download}\n' \
    "$GO2RTC/api/frame.jpeg?src=$NAME"
done

line "4. WebSocket-сигналинг MSE через nginx (ожидаем HTTP 101 Switching Protocols)"
for NAME in $NAMES; do
  curl -s --max-time 6 -o /dev/null -w "   $NAME ws: http=%{http_code}\n" \
    -H "Connection: Upgrade" -H "Upgrade: websocket" \
    -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
    "http://localhost/go2rtc/api/ws?src=$NAME"
done

line "5. Свежие ошибки в логах go2rtc (должно быть чисто, без codecs not matched)"
docker logs --tail 40 viziai-go2rtc-1 2>&1 | grep -iE 'error|codecs not matched|eof' | tail -10 || echo "чисто"

line "ГОТОВО"
echo "Главная проверка — открой дашборд в браузере: видео должно играть."
echo "В консоли браузера у <video-stream> должен появиться режим MSE (или HLS на iOS)."
