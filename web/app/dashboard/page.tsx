'use client'

import type * as React from 'react'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { IconUsers } from '@tabler/icons-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Input } from '@/components/ui/input'
import { VideoGrid } from '@/components/video-grid'
import { EventLog } from '@/components/event-log'
import { getCameras, getOccupancy } from '@/lib/api'
import { useEventStream } from '@/hooks/use-event-stream'

export default function DashboardPage(): React.JSX.Element {
  useEventStream()
  const [cols, setCols] = useState('2')
  const [search, setSearch] = useState('')
  // 15s poll keeps the online/offline badges honest (analyzer heartbeat TTL)
  const { data: cameras = [] } = useQuery({
    queryKey: ['cameras'], queryFn: getCameras, refetchInterval: 15000,
  })
  const { data: occupancy = [] } = useQuery({
    queryKey: ['occupancy'],
    queryFn: getOccupancy,
    refetchInterval: 5000,
  })

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

  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] flex-col gap-3 p-4 lg:h-[calc(100vh-3.5rem)]">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-lg font-semibold tracking-tight">Дашборд</h1>
        <span className="text-xs text-muted-foreground">
          {online} из {cameras.length} в сети
        </span>
        <div className="ml-auto flex items-center gap-2">
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
        </div>
      </header>

      {occupancy.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {occupancy.map((o) => (
            <div
              key={o.cameraId}
              className="flex items-center gap-3 rounded-lg border border-border/70 bg-card/60 px-3 py-2"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand/10 text-brand ring-1 ring-brand/20">
                <IconUsers className="h-4 w-4" stroke={1.75} />
              </span>
              <div className="leading-tight">
                <div className="text-xs text-muted-foreground">
                  {cameraNames[o.cameraId] ?? o.cameraId}
                </div>
                <div className="text-sm text-muted-foreground">
                  <span className="font-display text-base font-semibold tabular-nums text-brand">
                    {o.occupancy}
                  </span>{' '}
                  сейчас · {o.visitors} за день
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[1fr_320px]">
        <div className="min-h-0 overflow-y-auto">
          {visible.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              {cameras.length === 0 ? 'Камеры не добавлены.' : 'Ничего не найдено.'}
            </p>
          )}
          <VideoGrid cameras={visible} columns={Number(cols)} />
        </div>
        <aside className="min-h-0 overflow-hidden lg:h-auto">
          <EventLog cameraNames={cameraNames} />
        </aside>
      </div>
    </main>
  )
}
