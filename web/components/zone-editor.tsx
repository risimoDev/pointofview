'use client'

import type * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { createZone } from '@/lib/api'
import { zoneKindLabels } from '@/lib/labels'
import { ZoneKind, type Zone } from '@shared/events.schema'

type Point = [number, number] // normalized 0..1
type Kind = Zone['kind']

interface EditZone {
  name: string
  kind: Kind
  polygon: Point[]
  saved?: boolean
}

const KINDS = ZoneKind.options
const HANDLE_HIT = 12 // px

export function ZoneEditor({ cameraId, imageUrl }: { cameraId: string; imageUrl: string }): React.JSX.Element {
  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [zones, setZones] = useState<EditZone[]>([])
  const [draft, setDraft] = useState<Point[]>([])
  const dragRef = useRef<{ zone: number | 'draft'; idx: number } | null>(null)
  const movedRef = useRef(false)
  const [saving, setSaving] = useState(false)

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

    zones.forEach((z) => drawPoly(z.polygon, '#34d399', true))   // emerald = saved
    drawPoly(draft, '#2dd4bf', false)                            // teal = brand draft
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
        i === zi ? { ...z, polygon: z.polygon.map((pt, j) => (j === drag.idx ? p : pt)) } : z))
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
    setZones((zs) => [...zs, { name: `Зона ${zs.length + 1}`, kind: 'counter', polygon: draft }])
    setDraft([])
  }

  const updateZone = (idx: number, patch: Partial<EditZone>): void =>
    setZones((zs) => zs.map((z, i) => (i === idx ? { ...z, ...patch } : z)))

  const deleteZone = (idx: number): void =>
    setZones((zs) => zs.filter((_, i) => i !== idx))

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      for (const z of zones) {
        if (z.saved) continue
        await createZone(cameraId, { name: z.name, kind: z.kind, polygon: z.polygon })
      }
      setZones((zs) => zs.map((z) => ({ ...z, saved: true })))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex gap-4">
      <div className="relative w-fit select-none">
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

      <div className="flex w-72 flex-col gap-3">
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={closeDraft} disabled={draft.length < 3}>
            Замкнуть ({draft.length})
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDraft([])} disabled={draft.length === 0}>
            Сбросить
          </Button>
        </div>

        {zones.map((z, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border/70 bg-card/40 p-2.5">
            <Input value={z.name} onChange={(e) => updateZone(i, { name: e.target.value })} />
            <Select value={z.kind} onValueChange={(v) => updateZone(i, { kind: v as Kind })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => <SelectItem key={k} value={k}>{zoneKindLabels[k]}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{z.polygon.length} точек {z.saved && '· сохранено'}</span>
              <Button size="sm" variant="destructive" onClick={() => deleteZone(i)}>Удалить</Button>
            </div>
          </div>
        ))}

        <Button onClick={() => void save()} disabled={saving || zones.length === 0}>
          {saving ? 'Сохранение…' : 'Сохранить зоны'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Клик — точка, двойной клик — замкнуть, перетаскивание — двигать точки.
        </p>
      </div>
    </div>
  )
}
