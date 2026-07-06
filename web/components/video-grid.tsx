'use client'

import type * as React from 'react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useEventsStore } from '@/store/events.store'
import type { Camera } from '@shared/events.schema'

const CRITICAL_BLINK_MS = 3000

// MJPEG over the go2rtc HTTP proxy: works on every browser/device (incl. iOS
// Safari, which supports neither MSE nor reliable WebRTC here) and reuses the
// same nginx path snapshots already go through — no WebRTC/ICE/:8555 needed.
// Higher bandwidth than WebRTC; a codec-negotiated player is a later optimization.
function streamUrl(cameraId: string, nonce: number): string {
  return `/go2rtc/api/stream.mjpeg?src=${encodeURIComponent(cameraId)}&_=${nonce}`
}

function CameraTile({ camera }: { camera: Camera }): React.JSX.Element {
  const [blink, setBlink] = useState(false)
  const [nonce, setNonce] = useState(() => Date.now())
  const [failed, setFailed] = useState(false)
  const lastEvent = useEventsStore((s) => s.lastByCamera[camera.id])

  // retry a dropped MJPEG connection with a fresh nonce
  useEffect(() => {
    if (!failed) return
    const t = setTimeout(() => { setFailed(false); setNonce(Date.now()) }, 3000)
    return () => clearTimeout(t)
  }, [failed])

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
      {failed ? (
        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
          нет сигнала — переподключение…
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={streamUrl(camera.id, nonce)}
          alt={camera.name}
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
        />
      )}
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
