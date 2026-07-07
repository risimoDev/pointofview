'use client'

import type * as React from 'react'
import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { IconVideo, IconVectorTriangle, IconTrash } from '@tabler/icons-react'
import { getCameras, getSites, createCamera, updateCamera, deleteCamera } from '@/lib/api'
import type { Camera } from '@shared/events.schema'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { cameraStatusLabels, sourceTypeLabels } from '@/lib/labels'

const SOURCES = ['rtsp_pull', 'srt_push', 'file'] as const
const STATUSES = ['online', 'offline', 'error'] as const
const statusStyle: Record<string, string> = {
  online: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
  error: 'border-red-500/30 bg-red-500/15 text-red-300',
  offline: 'border-zinc-500/30 bg-zinc-500/15 text-zinc-300',
}

function CameraRow(
  { cam, siteName, onChanged }: { cam: Camera; siteName: string; onChanged: () => void },
): React.JSX.Element {
  const [edit, setEdit] = useState(false)
  const [name, setName] = useState(cam.name)
  const [urlMain, setUrlMain] = useState(cam.urlMain ?? '')
  const [urlSub, setUrlSub] = useState(cam.urlSub ?? '')
  const [status, setStatus] = useState<string>(cam.status)

  const save = useMutation({
    mutationFn: () => updateCamera(cam.id, {
      name, url_main: urlMain || null, url_sub: urlSub || null, status,
    }),
    onSuccess: () => { setEdit(false); onChanged() },
  })
  const rm = useMutation({ mutationFn: () => deleteCamera(cam.id), onSuccess: onChanged })

  return (
    <div className="border-b border-border/60 p-3 last:border-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">{cam.name}</span>
        <span className={cn('rounded-full border px-2 py-0.5 text-[11px]', statusStyle[cam.status] ?? statusStyle.offline)}>
          {cameraStatusLabels[cam.status]}
        </span>
        <span className="text-xs text-muted-foreground">{sourceTypeLabels[cam.sourceType]} · {siteName}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEdit((v) => !v)}>
            {edit ? 'Отмена' : 'Изменить'}
          </Button>
          <Link
            href={`/settings/cameras/${cam.id}/zones`}
            className="flex items-center gap-1 rounded-md border border-border/70 px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <IconVectorTriangle className="h-4 w-4" stroke={1.75} /> Зоны
          </Link>
          <Button
            size="sm" variant="ghost" className="text-muted-foreground hover:text-red-300"
            disabled={rm.isPending} onClick={() => rm.mutate()}
          >
            <IconTrash className="h-4 w-4" stroke={1.75} />
          </Button>
        </div>
      </div>
      {edit && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label>Название</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="w-44" />
          </div>
          <div className="space-y-1">
            <Label>Основной URL (архив)</Label>
            <Input value={urlMain} onChange={(e) => setUrlMain(e.target.value)} className="w-64" />
          </div>
          <div className="space-y-1">
            <Label>Доп. URL (ИИ-анализ)</Label>
            <Input value={urlSub} onChange={(e) => setUrlSub(e.target.value)} className="w-64" />
          </div>
          <div className="space-y-1">
            <Label>Статус</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{cameraStatusLabels[s]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>Сохранить</Button>
        </div>
      )}
    </div>
  )
}

export default function AdminCamerasPage(): React.JSX.Element {
  const qc = useQueryClient()
  const cams = useQuery({ queryKey: ['cameras'], queryFn: getCameras })
  const sites = useQuery({ queryKey: ['admin', 'sites'], queryFn: getSites })
  const siteName = (id: string): string => sites.data?.find((s) => s.id === id)?.name ?? id.slice(0, 8)
  const invalidate = (): void => void qc.invalidateQueries({ queryKey: ['cameras'] })

  const [siteId, setSiteId] = useState('')
  const [name, setName] = useState('')
  const [source, setSource] = useState<string>('rtsp_pull')
  const [urlMain, setUrlMain] = useState('')
  const [urlSub, setUrlSub] = useState('')
  const add = useMutation({
    mutationFn: () => createCamera({
      site_id: siteId, name, source_type: source,
      url_main: urlMain || null, url_sub: urlSub || null,
    }),
    onSuccess: () => { setName(''); setUrlMain(''); setUrlSub(''); invalidate() },
  })

  return (
    <main className="space-y-6">
      <div className="flex items-center gap-2">
        <IconVideo className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Камеры</h1>
      </div>

      <div className="overflow-hidden rounded-lg border border-border/70">
        {cams.data?.map((c) => (
          <CameraRow key={c.id} cam={c} siteName={siteName(c.siteId)} onChanged={invalidate} />
        ))}
        {cams.data?.length === 0 && <div className="p-3 text-sm text-muted-foreground">Камер нет.</div>}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Добавить камеру</h2>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); if (siteId && name) add.mutate() }}
        >
          <div className="space-y-1">
            <Label>Сайт</Label>
            <Select value={siteId} onValueChange={setSiteId}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Выберите сайт" /></SelectTrigger>
              <SelectContent>{sites.data?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Название</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label>Источник</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{sourceTypeLabels[s]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Основной URL</Label>
            <Input value={urlMain} onChange={(e) => setUrlMain(e.target.value)} className="w-56" />
          </div>
          <div className="space-y-1">
            <Label>Доп. URL</Label>
            <Input value={urlSub} onChange={(e) => setUrlSub(e.target.value)} className="w-56" />
          </div>
          <Button type="submit" disabled={!siteId || !name || add.isPending}>Добавить</Button>
        </form>
        {add.isError && <p className="text-sm text-red-400">Не удалось создать камеру</p>}
      </section>
    </main>
  )
}
