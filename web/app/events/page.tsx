'use client'

import type * as React from 'react'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { IconActivity, IconCheck, IconPhoto } from '@tabler/icons-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { getEvents, getEventSnapshotUrl, resolveEvent } from '@/lib/api'
import { useClipRequest } from '@/hooks/use-clip-request'
import { eventTypeLabels, severityLabels } from '@/lib/labels'
import { EventType, Severity, type ApiEvent } from '@shared/events.schema'

const severityVariant = { critical: 'destructive', warn: 'warn', info: 'info' } as const
const ANY = '__any__'

function ClipCell({ eventId }: { eventId: string }): React.JSX.Element {
  const { status, url, request } = useClipRequest(eventId)
  if (status === 'ready' && url) {
    return <a className="font-medium text-brand hover:underline" href={url} target="_blank" rel="noreferrer">Скачать</a>
  }
  return (
    <Button size="sm" variant="outline" disabled={status === 'processing'} onClick={request}>
      {status === 'processing' ? 'Нарезка…' : status === 'error' ? 'Ошибка' : 'Клип'}
    </Button>
  )
}

function SnapshotCell({ ev }: { ev: ApiEvent }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  if (!ev.snapshotKey) return <span className="text-xs text-muted-foreground">—</span>
  const open = async (): Promise<void> => {
    setBusy(true)
    try {
      const url = await getEventSnapshotUrl(ev.id)
      if (url) window.open(url, '_blank', 'noopener')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void open()} title="Открыть кадр">
      <IconPhoto className="h-4 w-4" stroke={1.75} />
    </Button>
  )
}

function ResolveCell({ ev, onDone }: { ev: ApiEvent; onDone: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  if (ev.resolved) return <span className="text-xs text-emerald-400">обработано</span>
  const resolve = async (): Promise<void> => {
    setBusy(true)
    try {
      await resolveEvent(ev.id)
      onDone()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void resolve()}>
      <IconCheck className="mr-1 h-3.5 w-3.5" stroke={2} /> Обработать
    </Button>
  )
}

function EventsTable(): React.JSX.Element {
  const router = useRouter()
  const sp = useSearchParams()
  const qc = useQueryClient()

  const filter = {
    camera_id: sp.get('camera_id') ?? undefined,
    type: sp.get('type') ?? undefined,
    severity: sp.get('severity') ?? undefined,
    resolved: (sp.get('resolved') ?? undefined) as 'true' | 'false' | undefined,
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
  }

  const setParam = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(sp.toString())
    if (value && value !== ANY) params.set(key, value)
    else params.delete(key)
    router.replace(`/events?${params.toString()}`)
  }, [router, sp])

  const query = useInfiniteQuery({
    queryKey: ['events', filter],
    queryFn: ({ pageParam }) => getEvents({ ...filter, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const refetch = (): void => void qc.invalidateQueries({ queryKey: ['events'] })

  const rows: ApiEvent[] = query.data?.pages.flatMap((p) => p.items) ?? []

  // infinite scroll sentinel
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
        void query.fetchNextPage()
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [query])

  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <IconActivity className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">События</h1>
      </div>

      <div className="flex flex-wrap gap-2 rounded-lg border border-border/70 bg-card/40 p-3">
        <Input
          placeholder="ID камеры"
          defaultValue={filter.camera_id ?? ''}
          onBlur={(e) => setParam('camera_id', e.target.value)}
          className="w-48"
        />
        <Select value={filter.type ?? ANY} onValueChange={(v) => setParam('type', v)}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Тип" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Все типы</SelectItem>
            {EventType.options.map((t) => <SelectItem key={t} value={t}>{eventTypeLabels[t]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filter.severity ?? ANY} onValueChange={(v) => setParam('severity', v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Важность" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Все</SelectItem>
            {Severity.options.map((s) => <SelectItem key={s} value={s}>{severityLabels[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          variant={filter.resolved === 'false' ? 'default' : 'outline'}
          onClick={() => setParam('resolved', filter.resolved === 'false' ? '' : 'false')}
        >
          Только необработанные
        </Button>
        <Input type="datetime-local" defaultValue={filter.from ?? ''}
          onChange={(e) => setParam('from', e.target.value ? new Date(e.target.value).toISOString() : '')} />
        <Input type="datetime-local" defaultValue={filter.to ?? ''}
          onChange={(e) => setParam('to', e.target.value ? new Date(e.target.value).toISOString() : '')} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Важность</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Камера</TableHead>
              <TableHead>Зона</TableHead>
              <TableHead className="whitespace-nowrap">Время</TableHead>
              <TableHead>Кадр</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Клип</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.id} className={e.resolved ? 'opacity-60' : undefined}>
                <TableCell><Badge variant={severityVariant[e.severity]}>{severityLabels[e.severity]}</Badge></TableCell>
                <TableCell>
                  <span className="whitespace-nowrap">{eventTypeLabels[e.type]}</span>
                  {typeof e.meta.ai_description === 'string' && (
                    <p className="mt-0.5 max-w-md text-xs text-muted-foreground">
                      {e.meta.ai_description}
                    </p>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">{e.cameraName ?? e.cameraId.slice(0, 8)}</TableCell>
                <TableCell className="whitespace-nowrap">{e.zoneName ?? (e.zoneId ? e.zoneId.slice(0, 8) : '—')}</TableCell>
                <TableCell className="whitespace-nowrap">{new Date(e.tsStart).toLocaleString('ru-RU')}</TableCell>
                <TableCell><SnapshotCell ev={e} /></TableCell>
                <TableCell><ResolveCell ev={e} onDone={refetch} /></TableCell>
                <TableCell><ClipCell eventId={e.id} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div ref={sentinel} className="h-8 text-center text-sm text-muted-foreground">
        {query.isFetchingNextPage ? 'Загрузка…' : query.hasNextPage ? '' : 'Конец списка'}
      </div>
    </main>
  )
}

export default function EventsPage(): React.JSX.Element {
  return (
    <Suspense>
      <EventsTable />
    </Suspense>
  )
}
