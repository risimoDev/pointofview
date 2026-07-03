'use client'

import type * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { IconVideo, IconVectorTriangle } from '@tabler/icons-react'
import { getCameras } from '@/lib/api'
import { cn } from '@/lib/utils'

const statusStyle: Record<string, string> = {
  online: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
  error: 'border-red-500/30 bg-red-500/15 text-red-300',
  offline: 'border-zinc-500/30 bg-zinc-500/15 text-zinc-300',
}

export default function CamerasPage(): React.JSX.Element {
  const { data: cameras = [], isLoading } = useQuery({ queryKey: ['cameras'], queryFn: getCameras })

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <IconVideo className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Камеры</h1>
      </div>

      {isLoading && <p className="text-muted-foreground">Загрузка…</p>}
      {!isLoading && cameras.length === 0 && (
        <p className="text-muted-foreground">Камеры не добавлены.</p>
      )}

      {cameras.length > 0 && (
        <ul className="flex flex-col divide-y divide-border/70 overflow-hidden rounded-lg border border-border/70">
          {cameras.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  <span className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                    statusStyle[c.status] ?? statusStyle.offline,
                  )}>
                    {c.status}
                  </span>
                </div>
                <div className="truncate font-mono text-xs text-muted-foreground">
                  {c.sourceType} · {c.id.slice(0, 8)}
                </div>
              </div>
              <Link
                href={`/settings/cameras/${c.id}/zones`}
                className="flex shrink-0 items-center gap-1.5 rounded-md border border-border/70 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <IconVectorTriangle className="h-4 w-4" stroke={1.75} />
                Зоны
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
