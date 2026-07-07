# go2rtc web player (vendored)

Adaptive video player from [go2rtc](https://github.com/AlexxIT/go2rtc), used by
the dashboard `<video-stream>` custom element. It negotiates the best transport
per device — MSE (desktop/Android) or native HLS (iOS) — with H264 passthrough.

- Source: `www/video-rtc.js` and `www/video-stream.js`
- Pinned to tag **v1.9.14** (matches the `alexxit/go2rtc` image in
  `infra/docker-compose.prod.yml`)
- License: MIT (© AlexxIT)

`video-stream.js` imports `./video-rtc.js`, so keep both files together and
served from the same path (`/players/`). Do not edit — to upgrade, re-fetch both
files at the new tag and bump this note.
