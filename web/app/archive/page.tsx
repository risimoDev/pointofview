'use client'

import type * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { IconPlayerPlay, IconAlertTriangle } from '@tabler/icons-react'
import {
  getCameras, getArchiveWindow, archivePlayUrl, errorMessage,
  type ArchiveSegment, type ArchiveEvent,
} from '@/lib/api'
import { eventTypeLabels, labelOf } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

const DAY_MS = 24 * 3600_000

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Local calendar day → [from,to] ISO for the API (whole day, capped at now). */
function dayRange(day: string): { from: string; to: string } {
  const start = new Date(`${day}T00:00:00`)
  const end = new Date(start.getTime() + DAY_MS)
  const now = new Date()
  const to = end > now ? now : end
  return { from: start.toISOString(), to: to.toISOString() }
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function hhmmss(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

const SEV_COLOR: Record<string, string> = {
  info: 'bg-sky-400',
  warn: 'bg-amber-400',
  critical: 'bg-red-500',
}

export default function ArchivePage(): React.JSX.Element {
  const cams = useQuery({ queryKey: ['cameras'], queryFn: getCameras })
  const [camId, setCamId] = useState('')
  const activeCam = camId || cams.data?.[0]?.id || ''
  const [day, setDay] = useState(todayStr())
  const range = useMemo(() => dayRange(day), [day])

  const win = useQuery({
    queryKey: ['archive', activeCam, range.from, range.to],
    queryFn: () => getArchiveWindow(activeCam, range.from, range.to),
    enabled: Boolean(activeCam),
    // ticket lives ~30 min; refetch keeps playback links from expiring mid-session
    refetchInterval: 20 * 60_000,
  })

  const videoRef = useRef<HTMLVideoElement>(null)
  const [current, setCurrent] = useState<ArchiveSegment | null>(null)
  const [seekTo, setSeekTo] = useState<number | null>(null) // seconds into segment

  const segments = win.data?.segments ?? []
  const events = win.data?.events ?? []
  const ticket = win.data?.ticket ?? ''

  // day window bounds for positioning (in ms)
  const winStart = new Date(range.from).getTime()
  const winEnd = new Date(range.to).getTime()
  const span = Math.max(1, winEnd - winStart)
  const pct = (ms: number): number => Math.min(100, Math.max(0, ((ms - winStart) / span) * 100))

  // reset the player when the camera or day changes
  useEffect(() => { setCurrent(null); setSeekTo(null) }, [activeCam, day])

  // load + optionally seek whenever the target segment changes
  useEffect(() => {
    const v = videoRef.current
    if (!v || !current || !ticket) return
    v.src = archivePlayUrl(current.id, ticket)
    v.load()
    const onMeta = (): void => {
      if (seekTo != null) v.currentTime = seekTo
      void v.play().catch(() => undefined)
    }
    v.addEventListener('loadedmetadata', onMeta, { once: true })
    return () => v.removeEventListener('loadedmetadata', onMeta)
  }, [current, ticket, seekTo])

  const segmentAt = (ms: number): ArchiveSegment | undefined =>
    segments.find((s) => {
      const a = new Date(s.startedAt).getTime()
      const b = s.endedAt ? new Date(s.endedAt).getTime() : a + 60_000
      return ms >= a && ms < b
    })

  const playAt = (ms: number): void => {
    const seg = segmentAt(ms) ?? segments.find((s) => new Date(s.startedAt).getTime() >= ms)
    if (!seg) return
    setSeekTo(Math.max(0, (ms - new Date(seg.startedAt).getTime()) / 1000))
    setCurrent(seg)
  }

  // auto-advance to the next segment so a whole period plays back continuously
  const onEnded = (): void => {
    if (!current) return
    const idx = segments.findIndex((s) => s.id === current.id)
    const next = idx >= 0 ? segments[idx + 1] : undefined
    if (next) { setSeekTo(0); setCurrent(next) }
  }

  return (
    <main className="space-y-4">
      <div className="flex items-center gap-2">
        <IconPlayerPlay className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Видеоархив</h1>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={activeCam} onValueChange={setCamId}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Камера" /></SelectTrigger>
          <SelectContent>
            {cams.data?.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          type="date"
          value={day}
          max={todayStr()}
          onChange={(e) => setDay(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
        />
        <span className="text-xs text-muted-foreground">
          {segments.length} сегм. · {events.length} соб.
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-border/70 bg-black">
        <video
          ref={videoRef}
          controls
          playsInline
          onEnded={onEnded}
          className="aspect-video w-full bg-black"
        />
      </div>
      {current && (
        <p className="text-xs text-muted-foreground">
          Воспроизведение с {hhmmss(current.startedAt)}
          {current.endedAt ? ` до ${hhmmss(current.endedAt)}` : ''}
        </p>
      )}

      {/* Timeline: recorded coverage + event markers over the chosen day */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{hhmm(range.from)}</span>
          <span>Шкала дня — клик, чтобы перемотать</span>
          <span>{hhmm(range.to)}</span>
        </div>
        <div
          className="relative h-12 w-full cursor-crosshair rounded-md border border-border/70 bg-muted/30"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const frac = (e.clientX - rect.left) / rect.width
            playAt(winStart + frac * span)
          }}
        >
          {segments.map((s) => {
            const a = pct(new Date(s.startedAt).getTime())
            const b = pct(s.endedAt ? new Date(s.endedAt).getTime() : new Date(s.startedAt).getTime() + 60_000)
            return (
              <div
                key={s.id}
                className={cn('absolute top-2 h-4 rounded-sm bg-brand/50',
                  current?.id === s.id && 'bg-brand ring-1 ring-brand')}
                style={{ left: `${a}%`, width: `${Math.max(0.3, b - a)}%` }}
                title={`${hhmmss(s.startedAt)} — запись`}
              />
            )
          })}
          {events.map((ev) => {
            const x = pct(new Date(ev.tsStart).getTime())
            return (
              <button
                key={ev.id}
                type="button"
                onClick={(e) => { e.stopPropagation(); playAt(new Date(ev.tsStart).getTime()) }}
                className={cn('absolute bottom-1 h-4 w-1 -translate-x-1/2 rounded-full',
                  SEV_COLOR[ev.severity] ?? 'bg-zinc-400')}
                style={{ left: `${x}%` }}
                title={`${hhmmss(ev.tsStart)} · ${labelOf(eventTypeLabels, ev.type as never)}`}
              />
            )
          })}
        </div>
      </div>

      {win.isError && (
        <p className="flex items-center gap-2 text-sm text-red-400">
          <IconAlertTriangle className="h-4 w-4" stroke={1.75} />
          {errorMessage(win.error)}
        </p>
      )}
      {win.data && segments.length === 0 && (
        <p className="text-sm text-muted-foreground">
          За выбранный день записей нет. Архив ведёт отдельный сервис recorder —
          убедитесь, что он запущен (профиль recorder в docker-compose) и у камеры
          указан основной поток (url_main).
        </p>
      )}

      {events.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">События этого дня</h2>
          <div className="flex flex-col gap-1">
            {events.map((ev: ArchiveEvent) => (
              <button
                key={ev.id}
                type="button"
                onClick={() => playAt(new Date(ev.tsStart).getTime())}
                className="flex items-center gap-3 rounded-md border border-border/60 bg-card/40 px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent"
              >
                <span className={cn('h-2 w-2 shrink-0 rounded-full', SEV_COLOR[ev.severity] ?? 'bg-zinc-400')} />
                <span className="w-20 shrink-0 tabular-nums text-muted-foreground">{hhmmss(ev.tsStart)}</span>
                <span>{labelOf(eventTypeLabels, ev.type as never)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
