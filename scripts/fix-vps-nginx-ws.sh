#!/usr/bin/env bash
# Запускать НА VPS (там, где TLS-nginx перед доменом), НЕ на домашнем сервере.
# Чинит проксирование WebSocket: Connection: $http_upgrade -> upgrade (через map),
# иначе второй nginx-хоп не входит в туннель-режим и MSE-видео/WS-события молчат
# (101 проходит, кадры не идут). Идемпотентно: бэкап, nginx -t, автооткат.
#   sudo bash scripts/fix-vps-nginx-ws.sh [/путь/к/viziai.conf]
set -euo pipefail

CONF="${1:-/etc/nginx/sites-available/viziai.conf}"
[ -f "$CONF" ] || { echo "НЕ найден конфиг: $CONF (передай путь аргументом)"; exit 1; }

BAK="$CONF.bak.$(date +%s)"
cp -a "$CONF" "$BAK"
echo "Бэкап: $BAK"

# 1) заголовок Connection -> переменная из map
sed -i 's/Connection \$http_upgrade;/Connection $viziai_conn_upgrade;/g' "$CONF"

# 2) сам map добавить один раз в начало файла (файл включается внутри http{})
if ! grep -q 'viziai_conn_upgrade[[:space:]]*{' "$CONF"; then
  cat > /tmp/_viziai_map.txt <<'MAP'
map $http_upgrade $viziai_conn_upgrade {
    default upgrade;
    ''      close;
}

MAP
  cat /tmp/_viziai_map.txt "$CONF" > "$CONF.new"
  mv "$CONF.new" "$CONF"
  rm -f /tmp/_viziai_map.txt
fi

echo "=== строки с viziai_conn_upgrade (ожидаем map + Connection) ==="
grep -n 'viziai_conn_upgrade' "$CONF" || {
  echo "!!! Строка 'Connection \$http_upgrade;' не найдена — возможно конфиг менялся вручную."
  echo "    Проверь блок 'location /' и замени Connection вручную."
}

if nginx -t; then
  systemctl reload nginx
  echo "OK: nginx перезагружен. Обнови дашборд — видео/события должны пойти."
else
  echo "ОШИБКА nginx -t — откатываю из бэкапа"
  cp -a "$BAK" "$CONF"
  exit 1
fi
