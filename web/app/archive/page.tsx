'use client'

import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  IconPlayerPlay, IconAlertTriangle, IconPlayerTrackNext, IconPlayerTrackPrev,
  IconRewindBackward10, IconRewindForward10, IconChevronLeft, IconChevronRight,
} from '@tabler/icons-react'
import {
  getCameras, getArchiveWindow, archivePlayUrl, errorMessage,
  type ArchiveSegment, type ArchiveEvent,
} from '@/lib/api'
import { eventTypeLabels, labelOf } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Page, PageHeader } from '@/components/ui/page'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

const DAY_MS = 24 * 3600_000
// A segment row without ended_at is the tail one still being written.
const OPEN_SEGMENT_MS = 5 * 60_000
const SPEEDS = [1, 2, 4, 8]

function dayStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayStr(): string {
  return dayStr(new Date())
}

function shiftDay(day: string, deltaDays: number): string {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + deltaDays)
  return dayStr(d)
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

function hhmmss(iso: string | number): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function segEnd(s: ArchiveSegment): number {
  return s.endedAt
    ? new Date(s.endedAt).getTime()
    : new Date(s.startedAt).getTime() + OPEN_SEGMENT_MS
}

/** Total recorded time in the window, for the "сколько записано" readout. */
function coverageMinutes(segments: ArchiveSegment[]): number {
  let ms = 0
  for (const s of segments) ms += segEnd(s) - new Date(s.startedAt).getTime()
  return Math.round(ms / 60_000)
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
    // the playback ticket lives ~30 min; refetch keeps a fresh one at hand
    refetchInterval: 20 * 60_000,
  })

  const videoRef = useRef<HTMLVideoElement>(null)
  const [current, setCurrent] = useState<ArchiveSegment | null>(null)
  // Where to land once the next segment's metadata arrives. A ref, not state:
  // as state it belonged to the load effect's dependencies, so dragging along
  // the timeline re-issued v.load() on every pointer move.
  const pendingSeek = useRef<number | null>(null)
  const [playheadMs, setPlayheadMs] = useState<number | null>(null)
  const [speed, setSpeed] = useState(1)

  const segments = win.data?.segments ?? []
  const events = win.data?.events ?? []
  const ticket = win.data?.ticket ?? ''
  const eventsTotal = win.data?.eventsTotal ?? events.length

  // The ticket is read through a ref, never as an effect dependency. As a
  // dependency it reloaded <video> every time the 20-minute refetch produced a
  // new one, throwing the viewer back to wherever playback had started.
  const ticketRef = useRef(ticket)
  useEffect(() => { ticketRef.current = ticket }, [ticket])

  // day window bounds for positioning (in ms)
  const winStart = new Date(range.from).getTime()
  const winEnd = new Date(range.to).getTime()
  const span = Math.max(1, winEnd - winStart)
  const pct = (ms: number): number => Math.min(100, Math.max(0, ((ms - winStart) / span) * 100))

  // reset the player when the camera or day changes
  useEffect(() => {
    setCurrent(null)
    pendingSeek.current = null
    setPlayheadMs(null)
  }, [activeCam, day])

  // load + optionally seek whenever the target segment changes
  useEffect(() => {
    const v = videoRef.current
    if (!v || !current || !ticketRef.current) return
    v.src = archivePlayUrl(current.id, ticketRef.current)
    v.load()
    const onMeta = (): void => {
      if (pendingSeek.current != null) v.currentTime = pendingSeek.current
      pendingSeek.current = null
      v.playbackRate = speed
      void v.play().catch(() => undefined)
    }
    v.addEventListener('loadedmetadata', onMeta, { once: true })
    return () => v.removeEventListener('loadedmetadata', onMeta)
    // `speed` deliberately omitted: changing it must not reload the video
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  useEffect(() => {
    const v = videoRef.current
    if (v) v.playbackRate = speed
  }, [speed])

  const segmentAt = useCallback((ms: number): ArchiveSegment | undefined =>
    segments.find((s) => ms >= new Date(s.startedAt).getTime() && ms < segEnd(s)),
  [segments])

  const playAt = useCallback((ms: number): void => {
    // clicking a gap jumps forward to where recording resumes, rather than
    // doing nothing — a gap is the most likely place to click by accident
    const seg = segmentAt(ms)
      ?? segments.find((s) => new Date(s.startedAt).getTime() >= ms)
      ?? [...segments].reverse().find((s) => segEnd(s) <= ms)
    if (!seg) return
    const offset = Math.max(0, (ms - new Date(seg.startedAt).getTime()) / 1000)
    const limit = Math.max(0, (segEnd(seg) - new Date(seg.startedAt).getTime()) / 1000 - 1)
    const target = Math.min(offset, limit)
    setPlayheadMs(ms)

    // Already inside this segment: seek in place. Reloading would restart the
    // buffer for a move the viewer experiences as a scrub.
    const v = videoRef.current
    if (v && current && seg.id === current.id && v.readyState > 0) {
      v.currentTime = target
      return
    }
    pendingSeek.current = target
    setCurrent(seg)
  }, [segmentAt, segments, current])

  // wall-clock position of the frame on screen, for the playhead and readout
  // timeupdate fires ~4×/s; the readout and playhead only need ~2×/s, and
  // every update re-renders the event list underneath
  const lastTick = useRef(0)
  const onTimeUpdate = (): void => {
    const v = videoRef.current
    if (!v || !current) return
    const now = performance.now()
    if (now - lastTick.current < 450) return
    lastTick.current = now
    setPlayheadMs(new Date(current.startedAt).getTime() + v.currentTime * 1000)
  }

  const stepSegment = useCallback((delta: number): void => {
    if (segments.length === 0) return
    const idx = current ? segments.findIndex((s) => s.id === current.id) : -1
    const next = segments[Math.min(segments.length - 1, Math.max(0, idx + delta))]
    if (next && next.id !== current?.id) {
      pendingSeek.current = 0
      setPlayheadMs(new Date(next.startedAt).getTime())
      setCurrent(next)
    }
  }, [segments, current])

  const skip = useCallback((seconds: number): void => {
    const v = videoRef.current
    if (!v || !current) return
    const target = v.currentTime + seconds
    // crossing a segment boundary is normal in an archive: hand off instead of
    // clamping at the edge, so ±10 s works the same everywhere on the timeline
    if (target < 0 || target > v.duration) {
      playAt(new Date(current.startedAt).getTime() + target * 1000)
      return
    }
    v.currentTime = target
  }, [current, playAt])

  const togglePlay = useCallback((): void => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play().catch(() => undefined)
    else v.pause()
  }, [])

  // Keyboard: the archive is reviewed for long stretches, and reaching for the
  // mouse for every ten seconds is the difference between usable and not.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      if (e.key === ' ') { e.preventDefault(); togglePlay() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); skip(-10) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); skip(10) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); stepSegment(-1) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); stepSegment(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, skip, stepSegment])

  // auto-advance so a whole period plays back without clicking
  const onEnded = (): void => {
    if (!current) return
    const idx = segments.findIndex((s) => s.id === current.id)
    const next = idx >= 0 ? segments[idx + 1] : undefined
    if (next) {
      pendingSeek.current = 0
      setPlayheadMs(new Date(next.startedAt).getTime())
      setCurrent(next)
    }
  }

  // An expired ticket shows up as a media error. Reload the same moment with
  // the fresh one instead of leaving a dead player on screen.
  const retriedAt = useRef(0)
  const onError = (): void => {
    if (!current || !ticketRef.current) return
    if (Date.now() - retriedAt.current < 5_000) return
    retriedAt.current = Date.now()
    const v = videoRef.current
    if (!v) return
    const pos = v.currentTime
    v.src = archivePlayUrl(current.id, ticketRef.current)
    v.load()
    v.addEventListener('loadedmetadata', () => {
      v.currentTime = pos
      void v.play().catch(() => undefined)
    }, { once: true })
  }

  // ── timeline scrubbing (pointer events: mouse and touch alike) ──
  const barRef = useRef<HTMLDivElement>(null)
  const msFromClientX = (clientX: number): number => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect) return winStart
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return winStart + frac * span
  }
  const [hoverMs, setHoverMs] = useState<number | null>(null)

  const hours = useMemo(() => {
    const out: number[] = []
    const first = new Date(winStart)
    first.setMinutes(0, 0, 0)
    for (let t = first.getTime(); t <= winEnd; t += 3600_000) {
      if (t >= winStart) out.push(t)
    }
    return out
  }, [winStart, winEnd])

  const covered = coverageMinutes(segments)

  return (
    <Page>
      <PageHeader title="Видеоархив" icon={IconPlayerPlay} />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={activeCam} onValueChange={setCamId}>
          <SelectTrigger className="w-full sm:w-56"><SelectValue placeholder="Камера" /></SelectTrigger>
          <SelectContent>
            {cams.data?.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Button
            variant="outline" size="icon" title="Предыдущий день"
            onClick={() => setDay((d) => shiftDay(d, -1))}
          >
            <IconChevronLeft className="h-4 w-4" stroke={1.75} />
          </Button>
          <input
            type="date"
            value={day}
            max={todayStr()}
            onChange={(e) => setDay(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          />
          <Button
            variant="outline" size="icon" title="Следующий день"
            disabled={day >= todayStr()}
            onClick={() => setDay((d) => shiftDay(d, 1))}
          >
            <IconChevronRight className="h-4 w-4" stroke={1.75} />
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          записано {Math.floor(covered / 60)} ч {covered % 60} мин · событий{' '}
          {eventsTotal > events.length
            ? `${events.length} из ${eventsTotal}`
            : events.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-border/70 bg-black">
        <video
          ref={videoRef}
          controls
          playsInline
          onEnded={onEnded}
          onTimeUpdate={onTimeUpdate}
          onError={onError}
          className="aspect-video w-full bg-black"
        />
      </div>

      {/* Transport. Big enough to hit on a phone; the same actions as the keys. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => stepSegment(-1)}
          disabled={segments.length === 0} title="Предыдущий фрагмент (стрелка вверх)">
          <IconPlayerTrackPrev className="h-4 w-4" stroke={1.75} />
        </Button>
        <Button variant="outline" size="sm" onClick={() => skip(-10)}
          disabled={!current} title="Назад 10 секунд (стрелка влево)">
          <IconRewindBackward10 className="h-4 w-4" stroke={1.75} />
        </Button>
        <Button variant="outline" size="sm" onClick={() => skip(10)}
          disabled={!current} title="Вперёд 10 секунд (стрелка вправо)">
          <IconRewindForward10 className="h-4 w-4" stroke={1.75} />
        </Button>
        <Button variant="outline" size="sm" onClick={() => stepSegment(1)}
          disabled={segments.length === 0} title="Следующий фрагмент (стрелка вниз)">
          <IconPlayerTrackNext className="h-4 w-4" stroke={1.75} />
        </Button>
        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <Button
              key={s} size="sm" variant={speed === s ? 'default' : 'outline'}
              className="h-8 px-2 text-xs tabular-nums"
              onClick={() => setSpeed(s)}
            >
              {s}×
            </Button>
          ))}
        </div>
        <span className="ml-auto font-display text-sm tabular-nums">
          {playheadMs !== null ? hhmmss(playheadMs) : '—:—:—'}
        </span>
      </div>

      {/* Timeline: recorded coverage + event markers + playhead over the day */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{hhmm(range.from)}</span>
          <span className="hidden sm:inline">
            Шкала суток — нажмите или проведите, чтобы перемотать
          </span>
          <span className="sm:hidden">Проведите по шкале</span>
          <span>{hhmm(range.to)}</span>
        </div>
        <div
          ref={barRef}
          className="relative h-16 w-full touch-none select-none rounded-md border border-border/70 bg-muted/30 sm:h-14"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            playAt(msFromClientX(e.clientX))
          }}
          onPointerMove={(e) => {
            setHoverMs(msFromClientX(e.clientX))
            // only scrub while the pointer is actually held down
            if (e.buttons === 1) playAt(msFromClientX(e.clientX))
          }}
          onPointerLeave={() => setHoverMs(null)}
        >
          {/* hour grid: without it the bar is an undifferentiated stripe */}
          {hours.map((t) => (
            <div
              key={t}
              className="pointer-events-none absolute inset-y-0 w-px bg-border/60"
              style={{ left: `${pct(t)}%` }}
            >
              <span className="absolute -top-0.5 left-1 text-[9px] text-muted-foreground/70">
                {new Date(t).getHours()}
              </span>
            </div>
          ))}

          {segments.map((s) => {
            const a = pct(new Date(s.startedAt).getTime())
            const b = pct(segEnd(s))
            return (
              <div
                key={s.id}
                className={cn('pointer-events-none absolute top-4 h-5 rounded-sm bg-brand/45',
                  current?.id === s.id && 'bg-brand/80')}
                style={{ left: `${a}%`, width: `${Math.max(0.3, b - a)}%` }}
              />
            )
          })}

          {events.map((ev) => {
            const x = pct(new Date(ev.tsStart).getTime())
            return (
              <button
                key={ev.id}
                type="button"
                onPointerDown={(e) => { e.stopPropagation(); playAt(new Date(ev.tsStart).getTime()) }}
                className={cn('absolute bottom-0.5 h-4 w-1.5 -translate-x-1/2 rounded-full',
                  SEV_COLOR[ev.severity] ?? 'bg-zinc-400')}
                style={{ left: `${x}%` }}
                title={`${hhmmss(ev.tsStart)} · ${labelOf(eventTypeLabels, ev.type as never)}`}
              />
            )
          })}

          {playheadMs !== null && (
            <div
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-foreground"
              style={{ left: `${pct(playheadMs)}%` }}
            />
          )}
          {hoverMs !== null && (
            <div
              className="pointer-events-none absolute -top-5 -translate-x-1/2 rounded bg-foreground px-1 text-[10px] tabular-nums text-background"
              style={{ left: `${pct(hoverMs)}%` }}
            >
              {hhmm(new Date(hoverMs).toISOString())}
            </div>
          )}
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
          <h2 className="text-sm font-medium text-muted-foreground">
            События этого дня
            {eventsTotal > events.length && (
              <span className="ml-2 font-normal text-amber-400/90">
                показаны первые {events.length} из {eventsTotal} — сузьте день
              </span>
            )}
          </h2>
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
            {events.map((ev: ArchiveEvent) => {
              const at = new Date(ev.tsStart).getTime()
              const active = playheadMs !== null && Math.abs(playheadMs - at) < 5000
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => playAt(at)}
                  className={cn(
                    'flex items-center gap-3 rounded-md border border-border/60 bg-card/40 px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
                    active && 'border-brand/60 bg-brand/10',
                  )}
                >
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', SEV_COLOR[ev.severity] ?? 'bg-zinc-400')} />
                  <span className="w-20 shrink-0 tabular-nums text-muted-foreground">{hhmmss(ev.tsStart)}</span>
                  <span className="truncate">{labelOf(eventTypeLabels, ev.type as never)}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}
    </Page>
  )
}
