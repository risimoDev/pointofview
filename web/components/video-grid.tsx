'use client'

import type * as React from 'react'
import { useEffect, useState } from 'react'
import { IconX } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { useEventsStore } from '@/store/events.store'
import { cameraStatusLabels, eventTypeLabels, severityLabels } from '@/lib/labels'
import { CameraStream } from './camera-stream'
import type { Camera } from '@shared/events.schema'

const CRITICAL_BLINK_MS = 3000

/** Fullscreen view of one camera: big stream + its recent events. */
function CameraModal({ camera, onClose }: {
  camera: Camera; onClose: () => void
}): React.JSX.Element {
  const events = useEventsStore((s) => s.events)
  const cameraEvents = events.filter((e) => e.cameraId === camera.id).slice(0, 12)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-6xl flex-col gap-3 lg:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg bg-black ring-1 ring-border/60">
          <div className="aspect-video">
            {camera.status === 'online'
              ? <CameraStream cameraId={camera.id} />
              : (
                <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                  {camera.status === 'error' ? 'ошибка камеры' : 'камера не в сети'}
                </div>
              )}
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-3 text-sm text-white">
            <span className="font-medium tracking-tight">{camera.name}</span>
            <span className="text-xs">{cameraStatusLabels[camera.status]}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-2 top-2 rounded-md bg-black/50 p-1.5 text-white transition-colors hover:bg-black/80"
            aria-label="Закрыть"
          >
            <IconX className="h-5 w-5" stroke={2} />
          </button>
        </div>
        <aside className="w-full shrink-0 overflow-y-auto rounded-lg border border-border/70 bg-card/90 p-3 lg:w-72">
          <h3 className="mb-2 font-display text-sm font-semibold tracking-tight">
            События камеры
          </h3>
          {cameraEvents.length === 0 && (
            <p className="text-sm text-muted-foreground">Пока нет событий (с момента открытия страницы).</p>
          )}
          <div className="space-y-1.5">
            {cameraEvents.map((e, i) => (
              <div key={`${e.id ?? 'live'}-${i}`} className="rounded-md border border-border/60 px-2 py-1.5 text-xs">
                <div className="font-medium">{eventTypeLabels[e.type]}</div>
                <div className="text-muted-foreground">
                  {severityLabels[e.severity]} · {new Date(e.tsStart).toLocaleTimeString('ru-RU')}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}

function CameraTile({ camera, onExpand }: {
  camera: Camera; onExpand: () => void
}): React.JSX.Element {
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
    <div
      className={cn('relative aspect-video cursor-pointer overflow-hidden rounded-lg bg-black ring-1 ring-border/60 transition-shadow hover:ring-brand/60', blink && 'animate-blink-red')}
      onClick={onExpand}
      title="Открыть на весь экран"
    >
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
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const expanded = cameras.find((c) => c.id === expandedId) ?? null

  return (
    <div className={cn('grid gap-2', COLS[columns] ?? 'grid-cols-2')}>
      {cameras.map((c) => (
        <CameraTile key={c.id} camera={c} onExpand={() => setExpandedId(c.id)} />
      ))}
      {expanded && <CameraModal camera={expanded} onClose={() => setExpandedId(null)} />}
    </div>
  )
}
