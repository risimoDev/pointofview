'use client'

import type * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { useEventsStore } from '@/store/events.store'
import { eventTypeLabels, severityLabels } from '@/lib/labels'
import type { UiEvent } from '@shared/events.schema'

const severityVariant: Record<UiEvent['severity'], 'destructive' | 'warn' | 'info'> = {
  critical: 'destructive',
  warn: 'warn',
  info: 'info',
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU')
}

export function EventLog({ cameraNames }: { cameraNames?: Record<string, string> }): React.JSX.Element {
  const events = useEventsStore((s) => s.events)

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border/70 bg-card/40">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <span className="font-display text-sm font-semibold tracking-tight">Лента событий</span>
        <span className="tabular-nums text-xs text-muted-foreground">{events.length}</span>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto p-1.5 text-sm">
        {events.length === 0 && (
          <p className="px-1.5 py-2 text-muted-foreground">Событий пока нет</p>
        )}
        {events.map((e, i) => (
          <div
            key={`${e.id ?? 'live'}-${i}`}
            className="flex items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-accent/60"
          >
            <Badge variant={severityVariant[e.severity]}>{severityLabels[e.severity]}</Badge>
            <span className="font-medium">{eventTypeLabels[e.type]}</span>
            <span className="truncate text-muted-foreground">
              {cameraNames?.[e.cameraId] ?? e.cameraId.slice(0, 8)}
            </span>
            <span className="ml-auto tabular-nums text-xs text-muted-foreground">{fmtTime(e.tsStart)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
