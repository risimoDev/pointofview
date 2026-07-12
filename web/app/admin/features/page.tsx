'use client'

import type * as React from 'react'
import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { IconAdjustmentsHorizontal } from '@tabler/icons-react'
import { getFeatures, setFeature, type Feature } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type FieldDef = { key: string; label: string; type: 'number' | 'bool'; def: number | boolean }
type FeatureMeta = { label: string; note?: string; fields: FieldDef[] }

// Per-plugin editable config, mirroring analyzer/plugins/*.py defaults.
const FEATURE_META: Record<string, FeatureMeta> = {
  crowd: {
    label: 'Скопление людей',
    fields: [
      { key: 'max_count', label: 'Порог людей', type: 'number', def: 10 },
      { key: 'cooldown_seconds', label: 'Пауза оповещения, сек', type: 'number', def: 60 },
    ],
  },
  counter: {
    label: 'Подсчёт / занятость',
    fields: [
      { key: 'interval_seconds', label: 'Интервал записи метрики, сек', type: 'number', def: 60 },
    ],
  },
  repack: {
    label: 'Перепаковка на стойке',
    fields: [
      { key: 'min_seconds', label: 'Мин. время на стойке, сек', type: 'number', def: 8 },
      { key: 'require_second_person', label: 'Требовать второго человека', type: 'bool', def: false },
    ],
  },
  shelf: {
    label: 'Полки / ячейки',
    fields: [
      { key: 'change_threshold', label: 'Порог изменения (0..1)', type: 'number', def: 0.1 },
      { key: 'settle_seconds', label: 'Стабилизация, сек', type: 'number', def: 2 },
    ],
  },
  reid: {
    label: 'Сквозная идентификация',
    note: 'Один человек на всех камерах точки. Сотрудники отмечаются на странице «Люди».',
    fields: [
      { key: 'match_threshold', label: 'Порог совпадения (0..1)', type: 'number', def: 0.88 },
      { key: 'staff_threshold', label: 'Порог сотрудника (0..1)', type: 'number', def: 0.90 },
      { key: 'gallery_ttl_hours', label: 'Память о посетителе, ч', type: 'number', def: 12 },
    ],
  },
  queue: { label: 'Очередь', note: 'Порог времени нахождения задаётся в настройках зоны.', fields: [] },
  ppe: { label: 'Средства защиты (СИЗ)', note: 'В разработке: требует серверной модели (RTX 3070).', fields: [] },
  face_id: { label: 'Распознавание лиц', note: 'В разработке: требует серверной модели + согласие по 152-ФЗ.', fields: [] },
}

function FeatureCard(
  { feature, meta, current, onSaved }:
  { feature: string; meta: FeatureMeta; current: Feature | undefined; onSaved: () => void },
): React.JSX.Element {
  const [enabled, setEnabled] = useState(current?.enabled ?? false)
  const [vals, setVals] = useState<Record<string, string | boolean>>(() => {
    const o: Record<string, string | boolean> = {}
    for (const f of meta.fields) {
      const cur = current?.config?.[f.key]
      o[f.key] = f.type === 'bool'
        ? (typeof cur === 'boolean' ? cur : Boolean(f.def))
        : (cur !== undefined && cur !== null ? String(cur) : String(f.def))
    }
    return o
  })

  const save = useMutation({
    mutationFn: () => {
      const config: Record<string, unknown> = {}
      for (const f of meta.fields) {
        const v = vals[f.key]
        if (f.type === 'bool') config[f.key] = Boolean(v)
        else {
          const n = Number(v)
          if (!Number.isNaN(n)) config[f.key] = n
        }
      }
      return setFeature(feature, enabled, config)
    },
    onSuccess: onSaved,
  })

  return (
    <div className="rounded-lg border border-border/70 bg-card/40 p-4">
      <div className="flex items-center gap-3">
        <span className="font-display text-sm font-semibold tracking-tight">{meta.label}</span>
        <Button
          size="sm"
          variant={enabled ? 'default' : 'outline'}
          className="ml-auto"
          onClick={() => setEnabled((v) => !v)}
        >
          {enabled ? 'Включено' : 'Выключено'}
        </Button>
      </div>
      {meta.note && <p className="mt-1 text-xs text-muted-foreground">{meta.note}</p>}

      {meta.fields.length > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          {meta.fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label>{f.label}</Label>
              {f.type === 'bool' ? (
                <Button
                  type="button"
                  size="sm"
                  variant={vals[f.key] ? 'default' : 'outline'}
                  className="w-24"
                  onClick={() => setVals((s) => ({ ...s, [f.key]: !s[f.key] }))}
                >
                  {vals[f.key] ? 'Да' : 'Нет'}
                </Button>
              ) : (
                <Input
                  type="number"
                  step="any"
                  value={String(vals[f.key] ?? '')}
                  onChange={(e) => setVals((s) => ({ ...s, [f.key]: e.target.value }))}
                  className="w-36"
                />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Сохранить</Button>
        {save.isSuccess && <span className="text-xs text-emerald-400">Сохранено</span>}
        {save.isError && <span className="text-xs text-red-400">Ошибка</span>}
      </div>
    </div>
  )
}

export default function AdminFeaturesPage(): React.JSX.Element {
  const qc = useQueryClient()
  const features = useQuery({ queryKey: ['admin', 'features'], queryFn: getFeatures })
  const onSaved = (): void => void qc.invalidateQueries({ queryKey: ['admin', 'features'] })

  return (
    <main className="space-y-4">
      <div className="flex items-center gap-2">
        <IconAdjustmentsHorizontal className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Функции</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Включение плагинов и пороги срабатывания. Изменения сразу уходят в Redis
        (<span className="font-mono text-xs">features:{'{tenant}'}</span>) и подхватываются анализатором.
      </p>

      <div className="grid gap-3">
        {Object.entries(FEATURE_META).map(([feature, meta]) => (
          <FeatureCard
            key={feature}
            feature={feature}
            meta={meta}
            current={features.data?.find((f) => f.feature === feature)}
            onSaved={onSaved}
          />
        ))}
      </div>
    </main>
  )
}
