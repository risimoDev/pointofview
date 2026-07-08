'use client'

import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'

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

const RETRY_MS = 7000

type StreamState = 'loading' | 'live' | 'down'

/**
 * Live camera view: adaptive H264 (MSE → HLS) via the vendored go2rtc player.
 * Shows «подключение…» until the first frame, «нет сигнала» + periodic hard
 * restart when the stream dies. The element is created imperatively so that
 * mode/background/visibilityThreshold are set BEFORE its first
 * connectedCallback — the player wires its visibility observers in oninit(),
 * which only runs once. Off-screen tiles then pause streaming automatically.
 */
export function CameraStream({ cameraId }: { cameraId: string }): React.JSX.Element {
  const slotRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<StreamState>('loading')
  const [gen, setGen] = useState(0) // bump to recreate the player element

  useEffect(() => {
    let active = true
    let el: VideoStreamElement | null = null
    setState('loading')
    void loadPlayer()
      .then(() => customElements.whenDefined('video-stream'))
      .then(() => {
        const slot = slotRef.current
        if (!active || !slot) return
        el = document.createElement('video-stream') as VideoStreamElement
        // MSE (desktop/Android, ~1s) then native HLS (iOS, ~2-4s). No WebRTC/UDP
        // and no MJPEG — H264 passthrough over the existing HTTPS proxy.
        el.mode = 'mse,hls'
        el.background = false
        el.visibilityThreshold = 0.15
        slot.appendChild(el) // connectedCallback → oninit picks the props up
        el.src = signalingURL(cameraId)
      })
      .catch(() => { if (active) setState('down') })
    return () => { active = false; el?.remove() }
  }, [cameraId, gen])

  // Media events don't bubble, but capture-phase listeners on an ancestor still
  // see them — that's how tile state tracks the inner <video> without touching
  // the player's internals.
  useEffect(() => {
    const slot = slotRef.current
    if (!slot) return
    const onPlaying = (): void => setState('live')
    const onError = (): void => setState('down')
    slot.addEventListener('playing', onPlaying, true)
    slot.addEventListener('error', onError, true)
    return () => {
      slot.removeEventListener('playing', onPlaying, true)
      slot.removeEventListener('error', onError, true)
    }
  }, [])

  // Dead stream → periodic hard restart (fresh WS + MSE negotiation)
  useEffect(() => {
    if (state !== 'down') return
    const t = setTimeout(() => setGen((g) => g + 1), RETRY_MS)
    return () => clearTimeout(t)
  }, [state, gen])

  return (
    <div className="relative h-full w-full">
      <div ref={slotRef} className="h-full w-full" />
      {state !== 'live' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          {state === 'loading' ? 'подключение…' : 'нет сигнала — переподключение…'}
        </div>
      )}
    </div>
  )
}
