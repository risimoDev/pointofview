'use client'

import type * as React from 'react'
import { useEffect, useRef } from 'react'

// The go2rtc player is vendored under /public/players and self-registers the
// <video-stream> custom element when its module runs. Load it once, lazily, on
// the client (a single shared promise dedupes concurrent tiles).
let playerLoad: Promise<void> | null = null
function loadPlayer(): Promise<void> {
  if (playerLoad) return playerLoad
  playerLoad = new Promise<void>((resolve, reject) => {
    if (customElements.get('video-stream')) { resolve(); return }
    const s = document.createElement('script')
    s.type = 'module'
    s.src = '/players/video-stream.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('go2rtc player failed to load'))
    document.head.appendChild(s)
  })
  return playerLoad
}

// go2rtc's /api/ws signaling endpoint, reached through the same /go2rtc/ proxy
// nginx already exposes. The player derives the HLS URL from this on its own.
function signalingURL(cameraId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/go2rtc/api/ws?src=${encodeURIComponent(cameraId)}`
}

/** Live camera view: adaptive H264 (MSE → HLS) via the vendored go2rtc player. */
export function CameraStream({ cameraId }: { cameraId: string }): React.JSX.Element {
  const ref = useRef<VideoStreamElement | null>(null)

  useEffect(() => {
    let active = true
    void loadPlayer()
      .then(() => customElements.whenDefined('video-stream'))
      .then(() => {
        const el = ref.current
        if (!active || !el) return
        // MSE (desktop/Android, ~1s) then native HLS (iOS, ~2-4s). No WebRTC/UDP
        // and no MJPEG — H264 passthrough over the existing HTTPS proxy. Order
        // matters: set mode/background before src so the first connect uses them.
        el.mode = 'mse,hls'
        el.background = false // pause when the tile scrolls off-screen or tab hides
        el.src = signalingURL(cameraId)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [cameraId])

  return <video-stream ref={ref} />
}
