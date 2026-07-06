# Shared proxy locations (included by both :80 and :443 servers).
# proxy_pass targets use variables (not the bare hostname) so nginx re-resolves
# them via the `resolver` directive in nginx.conf instead of caching the IP
# forever — see the comment there for why this matters.

# WebSocket (live events) — must come before /api
location /api/v1/ws/ {
  set $upstream_api api:3000;
  proxy_pass http://$upstream_api;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
  proxy_set_header Host $host;
  proxy_read_timeout 3600s;
}

# Only /api/v1 is the backend's real prefix. /api/auth/login|logout|token are
# Next.js's OWN server-side route handlers (they set the httpOnly cookie and
# then call the backend themselves) — matching bare /api here would swallow
# those before Next.js ever sees them and misroute them straight to Fastify,
# which 404s since it doesn't know a route without /v1.
location /api/v1 {
  set $upstream_api api:3000;
  proxy_pass http://$upstream_api;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}

# go2rtc lives on the host (network_mode: host), reached via the host gateway.
# Unlike api/web, host.docker.internal is a STABLE address resolved from
# /etc/hosts (extra_hosts) at startup — so use a literal upstream here. A
# variable would force resolution through `resolver 127.0.0.11` (docker DNS),
# which doesn't know host.docker.internal → 502 on WebRTC signaling.
location /go2rtc/ {
  proxy_pass http://host.docker.internal:1984/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
  proxy_set_header Host $host;
  # MJPEG / WS are long-lived streams: nginx must not buffer them or it never
  # flushes the (endless) response to the browser → blank <img>.
  proxy_buffering off;
  proxy_read_timeout 3600s;
  proxy_send_timeout 3600s;
}

location / {
  set $upstream_web web:3001;
  proxy_pass http://$upstream_web;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
