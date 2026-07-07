#!/usr/bin/env bash
# Глубокая проверка, что go2rtc реально выдаёт декодируемое видео по HLS:
# master.m3u8 → media.m3u8 → первый сегмент. Read-only.
# Usage: ./scripts/diag-mse.sh [stream_name]   (по умолчанию test)
set +e
GO2RTC="http://localhost:1984"
NAME="${1:-test}"
line() { printf '\n========== %s ==========\n' "$1"; }

line "1. master.m3u8 для '$NAME'"
MASTER="$(curl -s --max-time 10 "$GO2RTC/api/stream.m3u8?src=$NAME")"
echo "$MASTER"

# media-плейлист — первая строка без #; путь относительный к /api/
MEDIA_REL="$(printf '%s\n' "$MASTER" | grep -v '^#' | grep -v '^$' | head -1)"
echo "media playlist path: $MEDIA_REL"

line "2. media.m3u8 (список сегментов)"
MEDIA="$(curl -s --max-time 10 "$GO2RTC/api/$MEDIA_REL")"
echo "$MEDIA" | head -20

# первый сегмент
SEG_REL="$(printf '%s\n' "$MEDIA" | grep -v '^#' | grep -v '^$' | head -1)"
echo "первый сегмент: $SEG_REL"

line "3. Скачиваю первый сегмент — размер и формат (должен быть > десятков КБ)"
# сегмент может быть относителен к /api/ или к пути media-плейлиста
BASE_DIR="$(dirname "$MEDIA_REL")"
for url in \
  "$GO2RTC/api/$SEG_REL" \
  "$GO2RTC/api/$BASE_DIR/$SEG_REL" ; do
  code=$(curl -s --max-time 12 -o /tmp/diag_seg.bin -w '%{http_code}' "$url")
  sz=$(wc -c < /tmp/diag_seg.bin 2>/dev/null)
  echo "   $url -> http=$code bytes=$sz"
  if [ "$code" = "200" ] && [ "${sz:-0}" -gt 1000 ]; then
    echo "   формат сегмента:"; (command -v ffprobe >/dev/null && ffprobe -v error -show_entries stream=codec_name,codec_type -of default=nw=1 /tmp/diag_seg.bin | sed 's/^/     /') || head -c 16 /tmp/diag_seg.bin | xxd | head -1
    break
  fi
done

line "ИТОГ"
echo "Если сегмент скачался (>десятков КБ) и ffprobe показал h264 — go2rtc отдаёт видео,"
echo "значит проблема в браузере/VPS-транспорте, а не в go2rtc."
