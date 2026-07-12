'use client'

import type * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { IconTrash } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { createZone, deleteZone, getZones, updateZone } from '@/lib/api'
import { zoneKindLabels } from '@/lib/labels'
import { ZoneKind, type Zone } from '@shared/events.schema'

type Point = [number, number] // normalized 0..1
type Kind = Zone['kind']

// kinds the zone engine tracks dwell for (dwell_seconds → queue_alert)
const DWELL_KINDS: Kind[] = ['counter', 'desk', 'queue']
// kinds that can alert repeatedly → cooldown_seconds applies
const ALERTING_KINDS: Kind[] = ['counter', 'desk', 'queue', 'forbidden']

interface EditZone {
  id: string | null // null = ещё не сохранена
  name: string
  kind: Kind
  polygon: Point[]
  config: Record<string, unknown>
  active: boolean
  dirty: boolean
}

const KINDS = ZoneKind.options
const HANDLE_HIT = 12 // px

function numField(cfg: Record<string, unknown>, key: string): string {
  const v = cfg[key]
  return typeof v === 'number' || typeof v === 'string' ? String(v) : ''
}

export function ZoneEditor({ cameraId, imageUrl }: { cameraId: string; imageUrl: string }): React.JSX.Element {
  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [zones, setZones] = useState<EditZone[]>([])
  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState<Point[]>([])
  const dragRef = useRef<{ zone: number | 'draft'; idx: number } | null>(null)
  const movedRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const items = await getZones(cameraId)
    setZones(items.map((z) => ({
      id: z.id, name: z.name, kind: z.kind,
      polygon: z.polygon.map((p) => [p[0], p[1]] as Point),
      config: z.config, active: z.active, dirty: false,
    })))
    setLoaded(true)
  }, [cameraId])

  useEffect(() => {
    load().catch(() => setError('Не удалось загрузить зоны'))
  }, [load])

  const syncSize = useCallback(() => {
    const img = imgRef.current
    if (img) setSize({ w: img.clientWidth, h: img.clientHeight })
  }, [])

  useEffect(() => {
    window.addEventListener('resize', syncSize)
    return () => window.removeEventListener('resize', syncSize)
  }, [syncSize])

  // draw
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = size.w
    c.height = size.h
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, size.w, size.h)

    const drawPoly = (pts: Point[], color: string, closed: boolean): void => {
      if (pts.length === 0) return
      ctx.strokeStyle = color
      ctx.fillStyle = `${color}33`
      ctx.lineWidth = 2
      ctx.beginPath()
      pts.forEach(([nx, ny], i) => {
        const x = nx * size.w
        const y = ny * size.h
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      if (closed) { ctx.closePath(); ctx.fill() }
      ctx.stroke()
      for (const [nx, ny] of pts) {
        ctx.beginPath()
        ctx.arc(nx * size.w, ny * size.h, 5, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
      }
    }

    for (const z of zones) {
      // grey = выключена, amber = несохранённые правки, emerald = сохранена
      const color = !z.active ? '#71717a' : z.dirty || !z.id ? '#f59e0b' : '#34d399'
      drawPoly(z.polygon, color, true)
    }
    drawPoly(draft, '#2dd4bf', false) // teal = рисуемая
  }, [zones, draft, size])

  const toNorm = (e: React.PointerEvent | React.MouseEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    return [x, y]
  }

  const hitTest = (p: Point): { zone: number | 'draft'; idx: number } | null => {
    const px = p[0] * size.w
    const py = p[1] * size.h
    const near = (pt: Point): boolean =>
      Math.hypot(pt[0] * size.w - px, pt[1] * size.h - py) <= HANDLE_HIT
    for (let i = 0; i < draft.length; i++) if (near(draft[i]!)) return { zone: 'draft', idx: i }
    for (let z = 0; z < zones.length; z++) {
      const poly = zones[z]!.polygon
      for (let i = 0; i < poly.length; i++) if (near(poly[i]!)) return { zone: z, idx: i }
    }
    return null
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    movedRef.current = false
    const hit = hitTest(toNorm(e))
    if (hit) {
      dragRef.current = hit
      canvasRef.current?.setPointerCapture(e.pointerId)
    }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const drag = dragRef.current
    if (!drag) return
    movedRef.current = true
    const p = toNorm(e)
    if (drag.zone === 'draft') {
      setDraft((d) => d.map((pt, i) => (i === drag.idx ? p : pt)))
    } else {
      const zi = drag.zone
      setZones((zs) => zs.map((z, i) =>
        i === zi
          ? { ...z, dirty: true, polygon: z.polygon.map((pt, j) => (j === drag.idx ? p : pt)) }
          : z))
    }
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    if (dragRef.current) {
      dragRef.current = null
      canvasRef.current?.releasePointerCapture(e.pointerId)
      if (movedRef.current) return // was a drag, not a click
    }
    // plain click → add point to draft
    setDraft((d) => [...d, toNorm(e)])
  }

  const closeDraft = (): void => {
    if (draft.length < 3) return
    setZones((zs) => [...zs, {
      id: null, name: `Зона ${zs.length + 1}`, kind: 'counter',
      polygon: draft, config: {}, active: true, dirty: true,
    }])
    setDraft([])
  }

  const patchZone = (idx: number, patch: Partial<EditZone>): void =>
    setZones((zs) => zs.map((z, i) => (i === idx ? { ...z, ...patch, dirty: true } : z)))

  const patchConfig = (idx: number, key: string, raw: string): void =>
    setZones((zs) => zs.map((z, i) => {
      if (i !== idx) return z
      const config = { ...z.config }
      const n = Number(raw)
      if (raw === '' || Number.isNaN(n)) delete config[key]
      else config[key] = n
      return { ...z, config, dirty: true }
    }))

  const removeZone = async (idx: number): Promise<void> => {
    const z = zones[idx]
    if (!z) return
    if (z.id) {
      if (!window.confirm(`Удалить зону «${z.name}»? Её события останутся в истории.`)) return
      try {
        await deleteZone(cameraId, z.id)
      } catch {
        setError('Не удалось удалить зону')
        return
      }
    }
    setZones((zs) => zs.filter((_, i) => i !== idx))
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      for (const z of zones) {
        if (!z.dirty) continue
        const body = {
          name: z.name, kind: z.kind, polygon: z.polygon,
          config: z.config, active: z.active,
        }
        if (z.id) await updateZone(cameraId, z.id, body)
        else await createZone(cameraId, body)
      }
      await load() // сервер — источник истины (id новых зон и т.п.)
    } catch {
      setError('Не удалось сохранить изменения')
    } finally {
      setSaving(false)
    }
  }

  const dirtyCount = zones.filter((z) => z.dirty).length

  return (
    <div className="flex flex-wrap gap-4">
      <div className="relative w-fit select-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Снимок камеры"
          onLoad={syncSize}
          className="max-w-[800px] rounded-lg ring-1 ring-border/60"
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          className="absolute left-0 top-0 cursor-crosshair"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={closeDraft}
        />
      </div>

      <div className="flex w-80 flex-col gap-3">
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={closeDraft} disabled={draft.length < 3}>
            Замкнуть ({draft.length})
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDraft([])} disabled={draft.length === 0}>
            Сбросить
          </Button>
        </div>

        {!loaded && !error && <p className="text-sm text-muted-foreground">Загрузка зон…</p>}
        {loaded && zones.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Зон пока нет. Кликами по кадру обведи область и замкни её двойным кликом.
          </p>
        )}

        {zones.map((z, i) => (
          <div key={z.id ?? `new-${i}`} className="space-y-2 rounded-lg border border-border/70 bg-card/40 p-2.5">
            <div className="flex items-center gap-2">
              <Input value={z.name} onChange={(e) => patchZone(i, { name: e.target.value })} />
              <Button
                size="sm" variant="ghost"
                className="shrink-0 text-muted-foreground hover:text-red-300"
                onClick={() => void removeZone(i)}
                title="Удалить зону"
              >
                <IconTrash className="h-4 w-4" stroke={1.75} />
              </Button>
            </div>
            <Select value={z.kind} onValueChange={(v) => patchZone(i, { kind: v as Kind })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => <SelectItem key={k} value={k}>{zoneKindLabels[k]}</SelectItem>)}
              </SelectContent>
            </Select>

            {DWELL_KINDS.includes(z.kind) && (
              <div className="flex items-center gap-2">
                <span className="w-40 text-xs text-muted-foreground">Порог ожидания, сек</span>
                <Input
                  type="number" min={1} className="h-8"
                  placeholder="нет"
                  value={numField(z.config, 'dwell_seconds')}
                  onChange={(e) => patchConfig(i, 'dwell_seconds', e.target.value)}
                />
              </div>
            )}
            {ALERTING_KINDS.includes(z.kind) && (
              <div className="flex items-center gap-2">
                <span className="w-40 text-xs text-muted-foreground">Пауза оповещений, сек</span>
                <Input
                  type="number" min={1} className="h-8"
                  placeholder="по умолч."
                  value={numField(z.config, 'cooldown_seconds')}
                  onChange={(e) => patchConfig(i, 'cooldown_seconds', e.target.value)}
                />
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {z.polygon.length} точек
                {z.dirty && <span className="text-amber-400"> · не сохранено</span>}
              </span>
              <Button
                size="sm"
                variant={z.active ? 'default' : 'outline'}
                onClick={() => patchZone(i, { active: !z.active })}
              >
                {z.active ? 'Активна' : 'Выключена'}
              </Button>
            </div>
          </div>
        ))}

        <Button onClick={() => void save()} disabled={saving || dirtyCount === 0}>
          {saving ? 'Сохранение…' : dirtyCount > 0 ? `Сохранить изменения (${dirtyCount})` : 'Изменений нет'}
        </Button>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <p className="text-xs text-muted-foreground">
          Клик — точка, двойной клик — замкнуть, перетаскивание — двигать точки.
          Порог ожидания включает событие «Очередь» для зон подсчёта, стола выдачи и очереди.
        </p>
      </div>
    </div>
  )
}
