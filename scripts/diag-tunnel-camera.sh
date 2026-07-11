#!/usr/bin/env bash
# Проверка проброшенных камер точки ПВЗ — С ДОМАШНЕГО СЕРВЕРА, ДО добавления
# камеры в админке (для проверки уже добавленной камеры используй diag-camera.sh).
# Read-only. Запускать НА ДОМАШНЕМ СЕРВЕРЕ (viziai-server), из корня репозитория.
#
# Usage:
#   ./scripts/diag-tunnel-camera.sh 10.9.0.11                       # скан портов 554,5542-5546
#   ./scripts/diag-tunnel-camera.sh 10.9.0.11 5543                  # проверить один порт (TCP)
#   ./scripts/diag-tunnel-camera.sh 10.9.0.11 5543 "rtsp://user:pass@10.9.0.11:5543/stream2"
set +e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod"

IP="${1:-}"
PORT="${2:-}"
URL="${3:-}"
[ -n "$IP" ] || { echo "Usage: $0 <IP-точки, напр. 10.9.0.11> [порт] [RTSP-URL]"; exit 1; }

line() { printf '\n========== %s ==========\n' "$1"; }
tcp_open() { timeout 3 bash -c "cat < /dev/null > /dev/tcp/$1/$2" 2>/dev/null; }

line "1. Пинг до точки ($IP) — сам туннель/AmneziaWG-клиент отвечает?"
ping -c 3 -W 2 "$IP"

if [ -z "$PORT" ]; then
  line "2. Скан типовых портов проброса на $IP (554, 5542-5546)"
  for p in 554 5542 5543 5544 5545 5546; do
    if tcp_open "$IP" "$p"; then
      echo "  ОТКРЫТ  $IP:$p   <- тут проброшена камера"
    else
      echo "  закрыт  $IP:$p"
    fi
  done
  echo ""
  echo "Для полной проверки конкретного порта (пароль/путь):"
  echo "  $0 $IP 554 \"rtsp://логин:пароль@$IP:554/stream2\""
  exit 0
fi

line "2. TCP-порт $PORT на $IP"
if tcp_open "$IP" "$PORT"; then
  echo "OK: порт $PORT открыт — сервер достучался до точки ПВЗ."
else
  echo "!!! НЕ ОТКРЫТ: порт $PORT недоступен с сервера."
  echo "Проверь на ПК точки: служба AmneziaWG запущена (ШАГ 5)? проброс сделан именно на этот порт (ШАГ 4)?"
  exit 1
fi

if [ -z "$URL" ]; then
  echo ""
  echo "Порт открыт. Для честной проверки самого потока (логин/пароль/путь) добавь URL:"
  echo "  $0 $IP $PORT \"rtsp://логин:пароль@$IP:$PORT/путь\""
  exit 0
fi

line "3. Поток — ИЗ КОНТЕЙНЕРА analyzer (тот же путь, что у настоящего ИИ)"
if $COMPOSE ps analyzer >/dev/null 2>&1; then
  $COMPOSE exec -T analyzer ffprobe -hide_banner -rtsp_transport tcp -timeout 8000000 \
    -show_entries stream=codec_type,codec_name,width,height -of default=noprint_wrappers=1 -i "$URL"
  if [ $? -eq 0 ]; then
    echo ""
    echo "ОТЛИЧНО: analyzer открыл поток. Можно добавлять камеру в админке с этим URL."
  else
    echo ""
    echo "ОШИБКА: поток не открылся. Проверь логин/пароль/путь ещё раз (ШАГ 2 на точке)."
  fi
else
  echo "Контейнер analyzer не запущен — честная проверка потока пропущена."
fi

line "ГОТОВО"
