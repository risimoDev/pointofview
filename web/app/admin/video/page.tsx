'use client'

import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { IconPlayerPlay, IconUpload, IconBolt } from '@tabler/icons-react'
import { EventType, Severity } from '@shared/events.schema'
import { getCameras, simulateEvent } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const EVENT_TYPES = EventType.options
const SEVERITIES = Severity.options

export default function VideoTestPage(): React.JSX.Element {
  const cameras = useQuery({ queryKey: ['cameras'], queryFn: getCameras })

  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const prevUrl = useRef<string | null>(null)
  const onFile = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0]
    if (!f) return
    if (prevUrl.current) URL.revokeObjectURL(prevUrl.current)
    const url = URL.createObjectURL(f)
    prevUrl.current = url
    setVideoUrl(url)
  }
  useEffect(() => () => { if (prevUrl.current) URL.revokeObjectURL(prevUrl.current) }, [])

  const [cameraId, setCameraId] = useState('')
  const [type, setType] = useState<string>('crowd')
  const [severity, setSeverity] = useState<string>('warn')
  const [sent, setSent] = useState(0)
  const [auto, setAuto] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // default camera once loaded
  useEffect(() => {
    if (!cameraId && cameras.data && cameras.data.length > 0) setCameraId(cameras.data[0]!.id)
  }, [cameras.data, cameraId])

  const fire = async (evType: string): Promise<void> => {
    if (!cameraId) return
    try {
      await simulateEvent({ camera_id: cameraId, type: evType, severity })
      setSent((n) => n + 1)
      setError(null)
    } catch {
      setError('Не удалось отправить событие')
    }
  }

  // auto mode: random event every 3s
  useEffect(() => {
    if (!auto || !cameraId) return
    const id = setInterval(() => {
      const t = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)] ?? 'crowd'
      void fire(t)
    }, 3000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, cameraId, severity])

  return (
    <main className="space-y-6">
      <div className="flex items-center gap-2">
        <IconPlayerPlay className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Видео-тесты</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Фаза 1 — локальная симуляция: видео проигрывается в браузере, а события
        вбрасываются в реальный конвейер (Redis → consumer → БД → WebSocket → дашборд,
        и alerts-воркер, если есть правило). Серверная загрузка в MinIO и реальный
        прогон analyzer (YOLO) — фаза 2, на сервере с GPU.
      </p>

      {/* Video */}
      <section className="space-y-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/70 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <IconUpload className="h-4 w-4" stroke={1.75} />
          Загрузить видео
          <input type="file" accept="video/*" className="hidden" onChange={onFile} />
        </label>
        {videoUrl
          ? <video src={videoUrl} controls className="w-full max-w-2xl rounded-lg ring-1 ring-border/60" />
          : <div className="flex h-48 max-w-2xl items-center justify-center rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">Видео не выбрано</div>}
      </section>

      {/* Event simulator */}
      <section className="space-y-3 rounded-lg border border-border/70 bg-card/40 p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <IconBolt className="h-4 w-4 text-brand" stroke={1.75} /> Симулятор событий
        </h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label>Камера</Label>
            <Select value={cameraId} onValueChange={setCameraId}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Камера" /></SelectTrigger>
              <SelectContent>
                {cameras.data?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Тип события</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{EVENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Severity</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button disabled={!cameraId} onClick={() => void fire(type)}>Отправить событие</Button>
          <Button
            variant={auto ? 'default' : 'outline'}
            disabled={!cameraId}
            onClick={() => setAuto((v) => !v)}
          >
            {auto ? 'Стоп авто' : 'Авто (каждые 3с)'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Отправлено событий: <span className="font-semibold tabular-nums text-foreground">{sent}</span>
          {auto && <span className="ml-2 text-brand">● авто-режим</span>}
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <p className="text-xs text-muted-foreground">
          Открой <span className="font-mono">/dashboard</span> или <span className="font-mono">/events</span> в
          соседней вкладке — события появятся там в реальном времени.
        </p>
      </section>
    </main>
  )
}
