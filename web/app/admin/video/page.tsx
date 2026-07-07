'use client'

import type * as React from 'react'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { IconPlayerPlay, IconUpload, IconBolt } from '@tabler/icons-react'
import { EventType, Severity } from '@shared/events.schema'
import { getCameras, getSites, simulateEvent, uploadVideoCamera } from '@/lib/api'
import { eventTypeLabels, severityLabels } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const EVENT_TYPES = EventType.options
const SEVERITIES = Severity.options

export default function VideoTestPage(): React.JSX.Element {
  const qc = useQueryClient()
  const cameras = useQuery({ queryKey: ['cameras'], queryFn: getCameras })
  const sites = useQuery({ queryKey: ['sites'], queryFn: getSites })

  // ── upload video → file camera ──
  const [file, setFile] = useState<File | null>(null)
  const [upName, setUpName] = useState('')
  const [siteId, setSiteId] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [upMsg, setUpMsg] = useState<string | null>(null)
  useEffect(() => {
    if (!siteId && sites.data && sites.data.length > 0) setSiteId(sites.data[0]!.id)
  }, [sites.data, siteId])

  const doUpload = async (): Promise<void> => {
    if (!file || !siteId) return
    setUpMsg(null); setProgress(0)
    try {
      await uploadVideoCamera(file, siteId, upName || file.name, (p) => setProgress(p))
      setProgress(null)
      setUpMsg('Готово — камера создана, анализатор подхватит её в течение ~30с')
      setFile(null); setUpName('')
      await qc.invalidateQueries({ queryKey: ['cameras'] })
    } catch (e) {
      setProgress(null)
      setUpMsg(e instanceof Error ? e.message : 'Ошибка загрузки')
    }
  }

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
        Загрузи видеофайл — сервер сохранит его и создаст камеру-источник из видеофайла,
        которую реальный анализатор (YOLO) прогонит на GPU. Ниже — симулятор событий для
        проверки конвейера без видео.
      </p>

      {/* Upload video → file camera */}
      <section className="space-y-3 rounded-lg border border-border/70 bg-card/40 p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <IconUpload className="h-4 w-4 text-brand" stroke={1.75} /> Загрузить видео как камеру
        </h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label>Файл</Label>
            <input
              type="file" accept="video/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block text-sm text-muted-foreground file:mr-2 file:rounded-md file:border file:border-border/70 file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:text-foreground hover:file:bg-accent"
            />
          </div>
          <div className="space-y-1">
            <Label>Название</Label>
            <input
              value={upName} onChange={(e) => setUpName(e.target.value)}
              placeholder={file?.name ?? 'Камера'}
              className="h-9 w-52 rounded-md border border-border/70 bg-transparent px-3 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label>Точка (ПВЗ)</Label>
            <Select value={siteId} onValueChange={setSiteId}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Точка" /></SelectTrigger>
              <SelectContent>
                {sites.data?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={!file || !siteId || progress !== null}
            onClick={() => void doUpload()}
          >
            {progress !== null ? `Загрузка ${progress}%` : 'Загрузить'}
          </Button>
        </div>
        {progress !== null && (
          <div className="h-1.5 w-full max-w-lg overflow-hidden rounded bg-border/40">
            <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
        {upMsg && <p className="text-xs text-muted-foreground">{upMsg}</p>}
        <p className="text-xs text-muted-foreground">
          Большой файл (часовое видео) надёжнее закинуть на сервер по SSH в
          <span className="font-mono"> /mnt/data/testvideo/</span> и создать file-камеру
          в разделе «Камеры» — загрузка через браузер идёт по VPN-туннелю, и на больших
          файлах может оборваться.
        </p>
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
              <SelectContent>{EVENT_TYPES.map((t) => <SelectItem key={t} value={t}>{eventTypeLabels[t]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Важность</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{severityLabels[s]}</SelectItem>)}</SelectContent>
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
