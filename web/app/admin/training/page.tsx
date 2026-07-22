'use client'

import type * as React from 'react'
import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { IconSchool, IconTrash } from '@tabler/icons-react'
import {
  getTrainingSummary, getTrainingItems, deleteTrainingItems, errorMessage,
  type TrainingItem,
} from '@/lib/api'
import { eventTypeLabels, labelOf } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Стадия 1 обучения из панели: курирование датасета ложных срабатываний.
// Каждая пометка «ложное» на /events кладёт кадр в MinIO fp/{tenant}/{type}/ —
// здесь супер-админ просматривает набор, выкидывает мусорные кадры и видит,
// по каким типам уже накопилось достаточно для дообучения (стадия 2 — trainer).

// Event types with NO underlying model to fine-tune: zone_violation/queue_alert
// (zone-engine geometry — how long/where a track sat, not what it looks like),
// unknown_person and lone_worker (headcount logic). Their fp/ frames are only
// useful for spotting a detection bug (e.g. a track_id minted from noise) —
// never for training, so the panel says so instead of implying a model exists.
const NOT_TRAINABLE = new Set(['zone_violation', 'queue_alert', 'unknown_person', 'lone_worker'])

function fmtDate(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default function TrainingPage(): React.JSX.Element {
  const qc = useQueryClient()
  const summary = useQuery({ queryKey: ['training', 'summary'], queryFn: getTrainingSummary })
  const [sel, setSel] = useState<{ tenantId: string; type: string } | null>(null)
  const items = useQuery({
    queryKey: ['training', 'items', sel?.tenantId, sel?.type],
    queryFn: () => getTrainingItems(sel!.tenantId, sel!.type),
    enabled: Boolean(sel),
  })
  const [picked, setPicked] = useState<string[]>([])
  const [note, setNote] = useState<string | null>(null)

  const remove = useMutation({
    mutationFn: (keys: string[]) => deleteTrainingItems(keys),
    onSuccess: (_d, keys) => {
      setNote(`Удалено кадров: ${keys.length}`)
      setPicked([])
      void qc.invalidateQueries({ queryKey: ['training'] })
    },
    onError: (err) => setNote(errorMessage(err, 'Не удалось удалить')),
  })

  const total = (summary.data ?? []).reduce((s, r) => s + r.count, 0)

  return (
    <main className="space-y-4">
      <div className="flex items-center gap-2">
        <IconSchool className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Обучение моделей</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Датасет собирается сам: каждая пометка «ложное» на странице «События»
        сохраняет кадр сюда. Здесь набор чистится перед дообучением — удалите
        кадры, где разметка ошибочна (событие на кадре всё-таки есть) или кадр
        нечитаем. Для уверенного дообучения нужно от ~200 кадров на тип.
        Само дообучение (кнопкой) — следующий этап; пока датасет копится и
        чистится, а также используется ИИ-проверкой перед оповещениями.
      </p>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          Накоплено кадров: {total}
        </h2>
        {summary.isError && (
          <p className="text-sm text-red-400">{errorMessage(summary.error)}</p>
        )}
        {summary.data && summary.data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Пока пусто. Кадры появятся после пометок «ложное» на «Событиях».
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {summary.data?.map((r) => (
            <button
              key={`${r.tenantId}:${r.type}`}
              type="button"
              onClick={() => { setSel({ tenantId: r.tenantId, type: r.type }); setPicked([]) }}
              className={cn(
                'rounded-md border border-border/70 bg-card/40 px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
                sel?.tenantId === r.tenantId && sel.type === r.type && 'border-brand/60 bg-accent',
              )}
            >
              <div>{labelOf(eventTypeLabels, r.type as never)}</div>
              <div className="text-xs text-muted-foreground">
                {r.tenantName} · {r.count} кадров
                {NOT_TRAINABLE.has(r.type)
                  ? ' · без модели для дообучения'
                  : (r.count >= 200 ? ' · достаточно для обучения' : '')}
              </div>
            </button>
          ))}
        </div>
      </section>

      {sel && (
        <section className="space-y-2">
          {NOT_TRAINABLE.has(sel.type) && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              У этого типа нет отдельной модели — решение принимает движок зон
              (геометрия/время), а не нейросеть. Дообучить здесь нечего; кадры
              полезны только чтобы найти причину ложного срабатывания вручную
              (например, тряский трек от шумной детекции). Кандидаты на
              дообучение — «Нарушение СИЗ» и «Скопление людей».
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              Кадры: {labelOf(eventTypeLabels, sel.type as never)}
            </h2>
            <span className="text-xs text-muted-foreground">выбрано {picked.length}</span>
            <Button
              size="sm" variant="outline"
              disabled={picked.length === 0 || remove.isPending}
              onClick={() => {
                if (confirm(`Удалить ${picked.length} кадров из датасета? Отменить нельзя.`)) {
                  remove.mutate(picked)
                }
              }}
            >
              <IconTrash className="mr-1 h-4 w-4" stroke={1.75} /> Удалить выбранные
            </Button>
            {note && <span className="text-xs text-brand">{note}</span>}
          </div>
          {items.data && items.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Кадров нет.</p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {items.data?.map((it: TrainingItem) => {
              const on = picked.includes(it.key)
              return (
                <button
                  key={it.key}
                  type="button"
                  onClick={() => setPicked((s) => (on ? s.filter((k) => k !== it.key) : [...s, it.key]))}
                  className={cn(
                    'relative overflow-hidden rounded-md border bg-black/40 text-left',
                    on ? 'border-red-500 ring-1 ring-red-500' : 'border-border/60',
                  )}
                  title={`${fmtDate(it.lastModified)} — клик, чтобы отметить на удаление`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.url} alt="Кадр датасета" className="aspect-video w-full object-cover" />
                  <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">
                    {fmtDate(it.lastModified)}
                  </span>
                  {on && (
                    <span className="absolute right-1 top-1 rounded bg-red-500/90 px-1 text-[10px] text-white">
                      удалить
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </section>
      )}
    </main>
  )
}
