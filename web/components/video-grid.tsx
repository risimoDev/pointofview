'use client'

import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useEventsStore } from '@/store/events.store'
import type { Camera } from '@shared/events.schema'

const CRITICAL_BLINK_MS = 3000

function waitIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const check = (): void => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check)
        resolve()
      }
    }
    pc.addEventListener('icegatheringstatechange', check)
    setTimeout(resolve, 2000) // fallback: don't block forever
  })
}

async function startWhep(cameraId: string, video: HTMLVideoElement): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection()
  pc.addTransceiver('video', { direction: 'recvonly' })
  pc.addTransceiver('audio', { direction: 'recvonly' })
  pc.ontrack = (e) => { video.srcObject = e.streams[0] ?? null }

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  await waitIceGathering(pc)

  const res = await fetch(`/go2rtc/api/webrtc?src=${encodeURIComponent(cameraId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: pc.localDescription?.sdp ?? offer.sdp ?? '',
  })
  const answer = await res.text()
  await pc.setRemoteDescription({ type: 'answer', sdp: answer })
  return pc
}

function CameraTile({ camera }: { camera: Camera }): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [blink, setBlink] = useState(false)
  const lastEvent = useEventsStore((s) => s.lastByCamera[camera.id])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let pc: RTCPeerConnection | null = null
    let cancelled = false
    startWhep(camera.id, video)
      .then((p) => { if (cancelled) p.close(); else pc = p })
      .catch(() => undefined)
    return () => { cancelled = true; pc?.close() }
  }, [camera.id])

  useEffect(() => {
    if (lastEvent?.severity === 'critical') {
      setBlink(true)
      const t = setTimeout(() => setBlink(false), CRITICAL_BLINK_MS)
      return () => clearTimeout(t)
    }
    return undefined
  }, [lastEvent])

  return (
    <div className={cn('relative aspect-video overflow-hidden rounded-lg bg-black ring-1 ring-border/60', blink && 'animate-blink-red')}>
      <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain" />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-2 text-xs text-white">
        <span className="font-medium tracking-tight">{camera.name}</span>
        <span className={cn('flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
          camera.status === 'online' ? 'bg-emerald-500/20 text-emerald-300'
            : camera.status === 'error' ? 'bg-red-500/20 text-red-300'
              : 'bg-zinc-500/25 text-zinc-300')}>
          <span className={cn('h-1.5 w-1.5 rounded-full',
            camera.status === 'online' ? 'bg-emerald-400' : camera.status === 'error' ? 'bg-red-400' : 'bg-zinc-400')} />
          {camera.status}
        </span>
      </div>
      {lastEvent && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-xs text-white">
          {lastEvent.type} · {new Date(lastEvent.tsStart).toLocaleTimeString('ru-RU')}
        </div>
      )}
    </div>
  )
}

const COLS: Record<number, string> = {
  2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4',
}

export function VideoGrid({ cameras, columns }: { cameras: Camera[]; columns: number }): React.JSX.Element {
  return (
    <div className={cn('grid gap-2', COLS[columns] ?? 'grid-cols-2')}>
      {cameras.map((c) => <CameraTile key={c.id} camera={c} />)}
    </div>
  )
}
