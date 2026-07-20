'use client'

import type * as React from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { IconActivityHeartbeat, IconRefresh } from '@tabler/icons-react'
import { getHealth, getDeadLetter, replayDeadLetter } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function StatusDot({ ok }: { ok: boolean }): React.JSX.Element {
  return <span className={cn('h-2 w-2 rounded-full', ok ? 'bg-emerald-400' : 'bg-red-400')} />
}

function Stat({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border/70 bg-card/40 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

export default function DiagnosticsPage(): React.JSX.Element {
  const qc = useQueryClient()
  const health = useQuery({ queryKey: ['admin', 'health'], queryFn: getHealth, refetchInterval: 5000 })
  const dl = useQuery({ queryKey: ['admin', 'dead-letter'], queryFn: () => getDeadLetter(50) })
  const replay = useMutation({
    mutationFn: replayDeadLetter,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'dead-letter'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'health'] })
    },
  })

  const services = health.data?.services ?? {}
  const streams = health.data?.streams

  return (
    <main className="space-y-6">
      <div className="flex items-center gap-2">
        <IconActivityHeartbeat className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Диагностика</h1>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => {
            void health.refetch()
            void dl.refetch()
          }}
        >
          <IconRefresh className="mr-1 h-4 w-4" stroke={1.75} />
          Обновить
        </Button>
      </div>

      {/* Services */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Сервисы</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(services).map(([name, status]) => (
            <div
              key={name}
              className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/40 px-3 py-2 text-sm"
            >
              <StatusDot ok={status === 'ok'} />
              <span className="font-medium capitalize">{name}</span>
              <span className="text-muted-foreground">{status === 'ok' ? 'норма' : String(status)}</span>
            </div>
          ))}
          {health.isLoading && <span className="text-sm text-muted-foreground">Загрузка…</span>}
          {health.isError && <span className="text-sm text-red-400">Нет доступа или сервис недоступен</span>}
        </div>
      </section>

      {/* Streams */}
      {streams && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Потоки Redis</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={`События (${streams.events.name})`} value={streams.events.length} />
            <Stat label={`Не сохранены (${streams.failed.name})`} value={streams.failed.length} />
            <Stat label="В обработке" value={streams.group?.pending ?? '—'} />
            <Stat label="Отставание" value={streams.group?.lag ?? '—'} />
          </div>
        </section>
      )}

      {/* Dead-letter */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          Несохранённые события
        </h2>
        {dl.isLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
        {dl.data && dl.data.length === 0 && (
          <p className="text-sm text-muted-foreground">Пусто — все события обработаны.</p>
        )}
        <div className="space-y-2">
          {dl.data?.map((e) => (
            <div key={e.id} className="rounded-lg border border-border/70 bg-card/40 p-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{e.id}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  disabled={replay.isPending}
                  onClick={() => replay.mutate(e.id)}
                >
                  Повторить
                </Button>
              </div>
              <div className="mt-1 text-xs text-red-400">{e.error}</div>
              <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">
                {e.data}
              </pre>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
