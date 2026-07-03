'use client'

import type * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { getFeatures, setFeature, type Feature } from '@/lib/api'

// Catalog of toggleable plugins. `feature` must match analyzer FeaturePlugin.feature_id
// and the DB feature_kind enum.
const CATALOG: { feature: string; title: string; hint: string }[] = [
  { feature: 'crowd', title: 'Скопление (crowd)', hint: 'Событие при превышении числа людей в кадре/зоне' },
  { feature: 'counter', title: 'Подсчёт посетителей (counter)', hint: 'Занятость и трафик по counter-зонам' },
  { feature: 'repack', title: 'Перепаковка (repack)', hint: 'Обслуживание на стойке по dwell в desk-зоне' },
  { feature: 'queue', title: 'Очередь (queue)', hint: 'Алерт по длительности ожидания в queue-зоне' },
  { feature: 'shelf', title: 'Полки (shelf)', hint: 'Нарушения на полках/в ячейках выдачи' },
  { feature: 'ppe', title: 'СИЗ / PPE', hint: 'Каска/жилет (для завода)' },
  { feature: 'face_id', title: 'Распознавание лиц (face_id)', hint: 'Неизвестные лица. Внимание: 152-ФЗ' },
]

export default function FeaturesPage(): React.JSX.Element {
  const qc = useQueryClient()
  const { data: features = [] } = useQuery({ queryKey: ['features'], queryFn: getFeatures })

  const byId = new Map<string, Feature>(features.map((f) => [f.feature, f]))

  const toggle = useMutation({
    mutationFn: ({ feature, enabled }: { feature: string; enabled: boolean }) =>
      setFeature(feature, enabled, byId.get(feature)?.config ?? {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['features'] }),
  })

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1 className="font-display text-lg font-semibold tracking-tight">Функции аналитики</h1>
      <p className="text-sm text-muted-foreground">
        Включение применяется воркером в течение ~30 секунд. Требуется роль admin.
      </p>

      <ul className="flex flex-col divide-y rounded-md border">
        {CATALOG.map(({ feature, title, hint }) => {
          const enabled = byId.get(feature)?.enabled ?? false
          return (
            <li key={feature} className="flex items-center justify-between gap-4 p-4">
              <div>
                <div className="text-sm font-medium">{title}</div>
                <div className="text-xs text-muted-foreground">{hint}</div>
              </div>
              <Button
                variant={enabled ? 'default' : 'outline'}
                size="sm"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ feature, enabled: !enabled })}
              >
                {enabled ? 'Включено' : 'Выключено'}
              </Button>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
