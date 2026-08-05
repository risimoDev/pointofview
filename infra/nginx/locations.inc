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

# ── go2rtc ──────────────────────────────────────────────────────────────
# go2rtc has NO authentication of its own, and this location is reachable from
# the internet through the VPS. Proxying all of /go2rtc/ therefore published:
#   GET  /api/streams  → every camera's RTSP URL, passwords included
#   POST /api/streams  → add an arbitrary source to our server
#   GET  /api/frame.jpeg?src=… , the config editor, the whole web UI
# and let anyone holding a camera id watch it live.
#
# Two rules now: only the two paths the player actually uses are proxied at
# all, and each one is checked against the session first (auth_request →
# /api/v1/stream-auth, which reads the httpOnly cookie because a <video> tag
# and a WebSocket cannot send an Authorization header).
#
# Everything else under /go2rtc/ is refused below. Snapshots keep working:
# they go through the API (/api/v1/cameras/:id/snapshot), which talks to
# go2rtc server-side and is already behind the normal permission check.

# Internal subrequest target. proxy_pass_request_body off: auth_request must
# not forward the (possibly endless) stream body.
location = /go2rtc-auth {
  internal;
  set $upstream_api api:3000;
  proxy_pass http://$upstream_api/api/v1/stream-auth;
  proxy_pass_request_body off;
  proxy_set_header Content-Length "";
  proxy_set_header X-Original-URI $request_uri;
  proxy_set_header Host $host;
}

# MSE/MP4 signalling: the player's only entry point. `src` names the camera,
# so stream-auth can check it belongs to the caller's organisation.
location = /go2rtc/api/ws {
  auth_request /go2rtc-auth;
  proxy_pass http://host.docker.internal:1984/api/ws;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
  proxy_set_header Host $host;
  # long-lived stream: nginx must not buffer it or nothing reaches the browser
  proxy_buffering off;
  proxy_read_timeout 3600s;
  proxy_send_timeout 3600s;
}

# HLS fallback (iOS). Deliberately NOT behind auth_request, for a reason worth
# writing down: the browser loads the playlist as a `data:` URL, which gives it
# an opaque origin, so the segment requests may carry no cookie at all — the
# check would pass on desktop and fail on every iPhone.
#
# It is still gated, just one step earlier: these URLs do not exist until
# go2rtc hands the playlist over the WebSocket above, and it carries a session
# id go2rtc itself minted for that already-authorised connection. Guessing one
# is not meaningfully easier than guessing the session.
location /go2rtc/api/hls/ {
  proxy_pass http://host.docker.internal:1984/api/hls/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_buffering off;
  proxy_read_timeout 3600s;
}

location /go2rtc/ {
  return 404;
}

location / {
  set $upstream_web web:3001;
  proxy_pass http://$upstream_web;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
