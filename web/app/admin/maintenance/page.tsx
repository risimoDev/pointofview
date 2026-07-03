'use client'

import type * as React from 'react'
import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { IconTool, IconRefresh, IconTrash, IconDatabase } from '@tabler/icons-react'
import { getAudit, getTimescale, resync, clearDeadLetter } from '@/lib/api'
import { Button } from '@/components/ui/button'

function Stat({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border/70 bg-card/40 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

export default function MaintenancePage(): React.JSX.Element {
  const qc = useQueryClient()
  const ts = useQuery({ queryKey: ['admin', 'timescale'], queryFn: getTimescale })
  const audit = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => getAudit(50) })
  const [msg, setMsg] = useState<string | null>(null)

  const doResync = useMutation({
    mutationFn: resync,
    onSuccess: (r) => setMsg(`Ресинхр: камеры ${r.cameras}, фичи ${r.features}, зоны ${r.zones}`),
    onError: () => setMsg('Ошибка ресинхронизации'),
  })
  const doClear = useMutation({
    mutationFn: clearDeadLetter,
    onSuccess: (n) => {
      setMsg(`Очищено dead-letter: ${n}`)
      void qc.invalidateQueries({ queryKey: ['admin', 'health'] })
    },
    onError: () => setMsg('Ошибка очистки'),
  })

  return (
    <main className="space-y-6">
      <div className="flex items-center gap-2">
        <IconTool className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Обслуживание</h1>
      </div>

      {/* Actions */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Действия</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={doResync.isPending} onClick={() => doResync.mutate()}>
            <IconRefresh className="mr-1 h-4 w-4" stroke={1.75} />
            Ресинхр Redis (камеры/фичи/зоны)
          </Button>
          <Button variant="outline" disabled={doClear.isPending} onClick={() => doClear.mutate()}>
            <IconTrash className="mr-1 h-4 w-4" stroke={1.75} />
            Очистить dead-letter
          </Button>
        </div>
        {msg && <p className="text-sm text-brand">{msg}</p>}
        <p className="text-xs text-muted-foreground">
          Ресинхр перезаписывает Redis (<span className="font-mono">cameras:/features:/zones:</span>) из БД —
          полезно, если analyzer рассинхронизировался.
        </p>
      </section>

      {/* TimescaleDB */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <IconDatabase className="h-4 w-4" stroke={1.75} /> TimescaleDB — гипертаблица event
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="чанков всего" value={ts.data?.event.chunks ?? '—'} />
          <Stat label="сжато" value={ts.data?.event.compressed ?? '—'} />
        </div>
      </section>

      {/* Audit log */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Аудит-лог</h2>
        {audit.data && audit.data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Пусто. (Запись в audit_log пока не подключена — таблица готова.)
          </p>
        )}
        <div className="space-y-1">
          {audit.data?.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-lg border border-border/70 bg-card/40 p-2 text-sm">
              <span className="font-medium">{a.action}</span>
              <span className="text-xs text-muted-foreground">{a.resourceType ?? ''} {a.resourceId?.slice(0, 8) ?? ''}</span>
              <span className="ml-auto text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString('ru-RU')}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
