#!/usr/bin/env bash
# Проверка публичной поверхности после закрытия дыр (2026-08-05).
# Запускать С ЛЮБОЙ машины в интернете (не с сервера!) — смысл в том, чтобы
# смотреть на систему глазами постороннего.
#
#   ./scripts/diag-security.sh https://ваш-домен.ру
#
# Всё, что помечено ПЛОХО, означает дыру, открытую наружу.

set -uo pipefail

BASE="${1:-}"
if [ -z "$BASE" ]; then
  echo "использование: $0 https://домен" >&2
  exit 2
fi
BASE="${BASE%/}"

pass=0; fail=0

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@"; }
body() { curl -s --max-time 15 "$@"; }

check() { # описание  ожидаемые_коды  фактический
  local desc="$1" want="$2" got="$3"
  if [[ " $want " == *" $got "* ]]; then
    echo "  ХОРОШО  $desc (HTTP $got)"; pass=$((pass+1))
  else
    echo "  ПЛОХО   $desc — получили HTTP $got, ожидали одно из: $want"; fail=$((fail+1))
  fi
}

echo "── go2rtc: админ-API не должен быть доступен снаружи ──────────"
# До фикса это отдавало 200 со ВСЕМИ RTSP-адресами камер вместе с паролями.
check "GET /go2rtc/api/streams (список камер и паролей)" "404 403" "$(code "$BASE/go2rtc/api/streams")"
check "GET /go2rtc/api/config (конфигурация)"            "404 403" "$(code "$BASE/go2rtc/api/config")"
check "GET /go2rtc/ (веб-интерфейс)"                     "404 403" "$(code "$BASE/go2rtc/")"
check "GET /go2rtc/api/frame.jpeg (кадр с камеры)"       "404 403" "$(code "$BASE/go2rtc/api/frame.jpeg?src=any")"
check "PUT /go2rtc/api/streams (добавить свой источник)" "404 403 405" "$(code -X PUT "$BASE/go2rtc/api/streams?name=x&src=rtsp://1.2.3.4/x")"

echo
echo "── go2rtc: живое видео только по сессии ───────────────────────"
check "GET /go2rtc/api/ws без входа в систему" "401 403" "$(code "$BASE/go2rtc/api/ws?src=00000000-0000-0000-0000-000000000000")"

echo
echo "── служебные маршруты ─────────────────────────────────────────"
check "POST /internal/segments снаружи" "401 404" "$(code -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/internal/segments")"
check "GET /api/v1/stream-auth без куки"  "401"     "$(code "$BASE/api/v1/stream-auth")"

echo
echo "── доступ к API без токена ────────────────────────────────────"
check "GET /api/v1/cameras"        "401" "$(code "$BASE/api/v1/cameras")"
check "GET /api/v1/events"         "401" "$(code "$BASE/api/v1/events")"
check "GET /api/v1/admin/settings" "401" "$(code "$BASE/api/v1/admin/settings")"
check "GET /api/v1/admin/org-status" "401" "$(code "$BASE/api/v1/admin/org-status")"
check "GET /api/v1/occupancy"      "401" "$(code "$BASE/api/v1/occupancy")"

echo
echo "── заголовки безопасности на странице ─────────────────────────"
HEAD="$(curl -s -D - -o /dev/null --max-time 15 "$BASE/login")"
for h in "x-content-type-options" "x-frame-options" "referrer-policy" "content-security-policy"; do
  if grep -qi "^$h:" <<<"$HEAD"; then
    echo "  ХОРОШО  заголовок $h присутствует"; pass=$((pass+1))
  else
    echo "  ПЛОХО   заголовок $h отсутствует"; fail=$((fail+1))
  fi
done
if grep -qi "^strict-transport-security:" <<<"$HEAD"; then
  echo "  ХОРОШО  HSTS присутствует"; pass=$((pass+1))
else
  echo "  ВНИМАНИЕ HSTS нет — добавляется на VPS, где терминируется TLS"
fi

echo
echo "── срок жизни токена ──────────────────────────────────────────"
echo "  Проверяется вручную: войдите, откройте $BASE/api/auth/token,"
echo "  вставьте значение в jwt.io и убедитесь, что в payload ЕСТЬ поле exp."
echo "  До фикса его не было — токен жил вечно."

echo
echo "──────────────────────────────────────────────────────────────"
echo "  успешно: $pass, проблем: $fail"
[ "$fail" -eq 0 ] || echo "  Каждое ПЛОХО выше — это то, что видит посторонний."
exit 0
