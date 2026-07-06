'use client'

import type * as React from 'react'
import { Suspense, useCallback, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useInfiniteQuery } from '@tanstack/react-query'
import { IconActivity } from '@tabler/icons-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { getEvents } from '@/lib/api'
import { useClipRequest } from '@/hooks/use-clip-request'
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
      {status === 'processing' ? 'Нарезка…' : status === 'error' ? 'Ошибка' : 'Запросить клип'}
    </Button>
  )
}

function EventsTable(): React.JSX.Element {
  const router = useRouter()
  const sp = useSearchParams()

  const filter = {
    camera_id: sp.get('camera_id') ?? undefined,
    type: sp.get('type') ?? undefined,
    severity: sp.get('severity') ?? undefined,
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
          placeholder="camera_id"
          defaultValue={filter.camera_id ?? ''}
          onBlur={(e) => setParam('camera_id', e.target.value)}
          className="w-48"
        />
        <Select value={filter.type ?? ANY} onValueChange={(v) => setParam('type', v)}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Тип" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Все типы</SelectItem>
            {EventType.options.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filter.severity ?? ANY} onValueChange={(v) => setParam('severity', v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Все</SelectItem>
            {Severity.options.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="datetime-local" defaultValue={filter.from ?? ''}
          onChange={(e) => setParam('from', e.target.value ? new Date(e.target.value).toISOString() : '')} />
        <Input type="datetime-local" defaultValue={filter.to ?? ''}
          onChange={(e) => setParam('to', e.target.value ? new Date(e.target.value).toISOString() : '')} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Severity</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Камера</TableHead>
              <TableHead>Зона</TableHead>
              <TableHead className="whitespace-nowrap">Время</TableHead>
              <TableHead>Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell><Badge variant={severityVariant[e.severity]}>{e.severity}</Badge></TableCell>
                <TableCell className="whitespace-nowrap">{e.type}</TableCell>
                <TableCell className="font-mono text-xs">{e.cameraId.slice(0, 8)}</TableCell>
                <TableCell className="font-mono text-xs">{e.zoneId?.slice(0, 8) ?? '—'}</TableCell>
                <TableCell className="whitespace-nowrap">{new Date(e.tsStart).toLocaleString('ru-RU')}</TableCell>
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
