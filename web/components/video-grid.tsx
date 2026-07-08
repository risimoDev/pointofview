'use client'

import type * as React from 'react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useEventsStore } from '@/store/events.store'
import { cameraStatusLabels, eventTypeLabels } from '@/lib/labels'
import { CameraStream } from './camera-stream'
import type { Camera } from '@shared/events.schema'

const CRITICAL_BLINK_MS = 3000

function CameraTile({ camera }: { camera: Camera }): React.JSX.Element {
  const [blink, setBlink] = useState(false)
  const lastEvent = useEventsStore((s) => s.lastByCamera[camera.id])

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
      {camera.status === 'online' ? (
        <CameraStream cameraId={camera.id} />
      ) : (
        // offline/error: a static plate instead of a doomed connection attempt
        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
          {camera.status === 'error' ? 'ошибка камеры' : 'камера не в сети'}
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-2 text-xs text-white">
        <span className="font-medium tracking-tight">{camera.name}</span>
        <span className={cn('flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
          camera.status === 'online' ? 'bg-emerald-500/20 text-emerald-300'
            : camera.status === 'error' ? 'bg-red-500/20 text-red-300'
              : 'bg-zinc-500/25 text-zinc-300')}>
          <span className={cn('h-1.5 w-1.5 rounded-full',
            camera.status === 'online' ? 'bg-emerald-400' : camera.status === 'error' ? 'bg-red-400' : 'bg-zinc-400')} />
          {cameraStatusLabels[camera.status]}
        </span>
      </div>
      {lastEvent && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-xs text-white">
          {eventTypeLabels[lastEvent.type]} · {new Date(lastEvent.tsStart).toLocaleTimeString('ru-RU')}
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
