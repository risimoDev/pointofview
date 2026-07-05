#!/usr/bin/env bash
# Diagnostic dump for the home server routing chain. Read-only, safe to run.
# Usage: ./scripts/diag-home.sh   (from repo root)
# Send the full output back for analysis.
set +e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod"

line() { printf '\n========== %s ==========\n' "$1"; }

line "git state (is the fix pulled?)"
git log -1 --oneline
git status --short

line "locations.inc ON DISK (should say /api/v1, not bare /api)"
grep -n "location /api" infra/nginx/locations.inc

line "container status"
$COMPOSE ps

line "nginx config ACTUALLY LOADED inside the container"
$COMPOSE exec -T nginx cat /etc/nginx/locations.inc 2>&1 | grep -n "location /api"

line "nginx -t"
$COMPOSE exec -T nginx nginx -t 2>&1

line "web container: is it the freshly built image? (check image id + age)"
docker inspect --format '{{.Config.Image}} created={{.Created}}' "$($COMPOSE ps -q web)" 2>&1

line "TEST 1: /api/auth/login should hit Next.js (302 redirect), NOT Fastify 404"
curl -s -o /dev/null -w 'http_code=%{http_code} redirect=%{redirect_url}\n' \
  -X POST http://localhost/api/auth/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'email=super@viziai.local&password=super12345'

line "TEST 1b: full body of that same request"
curl -s -X POST http://localhost/api/auth/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'email=super@viziai.local&password=super12345' | head -c 400
echo

line "TEST 2: /api/v1/auth/login DIRECT to backend via nginx (should be 200 + token)"
curl -s -X POST http://localhost/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  --data '{"email":"super@viziai.local","password":"super12345"}' | head -c 400
echo

line "TEST 3: same but straight to the web container, bypassing nginx"
WEB_CID="$($COMPOSE ps -q web)"
docker exec "$WEB_CID" sh -c 'wget -qO- --post-data="email=super@viziai.local&password=super12345" --header="Content-Type: application/x-www-form-urlencoded" --server-response http://localhost:3001/api/auth/login 2>&1 | head -30' 2>&1 | head -30

line "TEST 4: which upstream does nginx pick for /api/auth vs /api/v1 (health)"
curl -s -o /dev/null -w '/api/v1/health -> %{http_code}\n' http://localhost/api/v1/health

line "DONE"
