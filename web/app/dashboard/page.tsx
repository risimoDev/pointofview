'use client'

import type * as React from 'react'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  IconUsers, IconVideo, IconAlertTriangle, IconInbox,
} from '@tabler/icons-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Input } from '@/components/ui/input'
import { Page, PageHeader, StatCard } from '@/components/ui/page'
import { VideoGrid } from '@/components/video-grid'
import { EventLog } from '@/components/event-log'
import { getCameras, getEvents, getOccupancy } from '@/lib/api'
import { useEventStream } from '@/hooks/use-event-stream'

/** Local midnight, as the API wants it. */
function todayFrom(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export default function DashboardPage(): React.JSX.Element {
  useEventStream()
  const [cols, setCols] = useState('2')
  const [search, setSearch] = useState('')
  // 15s poll keeps the online/offline badges honest (analyzer heartbeat TTL)
  const { data: cameras = [] } = useQuery({
    queryKey: ['cameras'], queryFn: getCameras, refetchInterval: 15000,
  })
  const { data: occupancy } = useQuery({
    queryKey: ['occupancy'],
    queryFn: getOccupancy,
    refetchInterval: 5000,
  })
  // Two counts the operator is actually judged on: what blew up today and
  // what nobody has dealt with. Cheap queries, one minute apart.
  const { data: criticalToday } = useQuery({
    queryKey: ['kpi-critical'],
    queryFn: () => getEvents({ severity: 'critical', from: todayFrom(), limit: 100 }),
    refetchInterval: 60_000,
  })
  const { data: unresolved } = useQuery({
    queryKey: ['kpi-unresolved'],
    queryFn: () => getEvents({ resolved: 'false', limit: 100 }),
    refetchInterval: 60_000,
  })

  const occupancyItems = occupancy?.items ?? []
  const visitorSites = occupancy?.sites ?? []

  const cameraNames = useMemo(
    () => Object.fromEntries(cameras.map((c) => [c.id, c.name])),
    [cameras],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return cameras
    return cameras.filter((c) => c.name.toLowerCase().includes(q))
  }, [cameras, search])

  const online = useMemo(
    () => cameras.filter((c) => c.status === 'online').length,
    [cameras],
  )
  const peopleNow = occupancyItems.reduce((s, o) => s + o.occupancy, 0)
  const visitorsToday = visitorSites.reduce((s, o) => s + o.visitors, 0)

  // "100+" rather than a wrong number: the queries are capped at 100
  const capped = (n: number | undefined, limit = 100): string =>
    n === undefined ? '—' : n >= limit ? `${limit}+` : String(n)

  return (
    <Page fill className="gap-3">
      <PageHeader title="Дашборд" subtitle={`${online} из ${cameras.length} в сети`}>
        {cameras.length > 4 && (
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск камеры…"
            className="h-8 w-44"
          />
        )}
        <ToggleGroup type="single" value={cols} onValueChange={(v) => v && setCols(v)}>
          <ToggleGroupItem value="2">2×2</ToggleGroupItem>
          <ToggleGroupItem value="3" className="hidden sm:flex">3×3</ToggleGroupItem>
          <ToggleGroupItem value="4" className="hidden sm:flex">4×4</ToggleGroupItem>
        </ToggleGroup>
      </PageHeader>

      <div className="grid shrink-0 grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard
          label="Камеры в сети" icon={IconVideo}
          value={`${online} / ${cameras.length}`}
          tone={cameras.length > 0 && online < cameras.length ? 'warn' : 'brand'}
        />
        <StatCard
          label="Критических сегодня" icon={IconAlertTriangle} tone="critical"
          value={capped(criticalToday?.items.length)}
        />
        <StatCard
          label="Не разобрано" icon={IconInbox} tone="warn"
          value={capped(unresolved?.items.length)}
        />
        <StatCard
          label={visitorSites.length > 0 ? 'Посетителей за день' : 'Людей сейчас'}
          icon={IconUsers} tone="brand"
          value={visitorSites.length > 0 ? visitorsToday : peopleNow}
          hint={visitorSites.length > 0
            ? 'Разные люди за сутки по площадке; сотрудники не считаются'
            : 'Сколько людей видят камеры прямо сейчас'}
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
        <div className="min-h-0 overflow-y-auto">
          {visible.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              {cameras.length === 0 ? 'Камеры не добавлены.' : 'Ничего не найдено.'}
            </p>
          )}
          <VideoGrid cameras={visible} columns={Number(cols)} />
        </div>
        <aside className="hidden min-h-0 overflow-hidden lg:block">
          <EventLog cameraNames={cameraNames} />
        </aside>
      </div>
    </Page>
  )
}
