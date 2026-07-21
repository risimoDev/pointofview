'use client'

import type * as React from 'react'
import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { IconAdjustmentsHorizontal } from '@tabler/icons-react'
import {
  getFeatures, getFeatureStatus, getVlmStatus, setFeature, testVlm, errorMessage,
  type Feature, type PluginStatus, type VlmStatus, type VlmTest,
} from '@/lib/api'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type FieldDef = {
  key: string; label: string
  type: 'number' | 'bool' | 'select'
  def: number | boolean | string
  options?: { value: string; label: string }[]
}
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
    note: 'Один человек на всех камерах точки. Сотрудники отмечаются на странице «Люди». '
      + 'Новая личность создаётся только после нескольких качественных замеров — '
      + 'это защита от двойного счёта при мерцании трекинга и ночной ИК-съёмке.',
    fields: [
      { key: 'match_threshold', label: 'Порог совпадения (0..1)', type: 'number', def: 0.88 },
      { key: 'staff_threshold', label: 'Порог сотрудника (0..1)', type: 'number', def: 0.90 },
      { key: 'gallery_ttl_hours', label: 'Память о посетителе, ч', type: 'number', def: 12 },
      { key: 'min_samples', label: 'Замеров до новой личности', type: 'number', def: 3 },
      { key: 'min_track_age_seconds', label: 'Мин. время наблюдения, сек', type: 'number', def: 3 },
      { key: 'min_confidence', label: 'Мин. уверенность детекции (0..1)', type: 'number', def: 0.5 },
      { key: 'min_crop_px', label: 'Мин. размер кадра человека, пикс', type: 'number', def: 64 },
      { key: 'min_saturation', label: 'Мин. цветность кадра (0-255)', type: 'number', def: 25 },
    ],
  },
  queue: { label: 'Очередь', note: 'Порог времени нахождения задаётся в настройках зоны.', fields: [] },
  ppe: {
    label: 'Средства защиты (СИЗ)',
    note: 'Каски и жилеты в зонах «Зона СИЗ». Нужен файл модели на сервере '
      + '(/models/ppe.pt); без него функция включится, но покажет ошибку ниже. '
      + 'Требуемый набор (helmet/vest) задаётся в настройках зоны, поле required.',
    fields: [
      { key: 'grace_seconds', label: 'Отсрочка после входа, сек', type: 'number', def: 5 },
      { key: 'min_checks_without', label: 'Проверок без СИЗ до события', type: 'number', def: 3 },
      { key: 'min_confidence', label: 'Мин. уверенность (0..1)', type: 'number', def: 0.6 },
      { key: 'min_person_px', label: 'Мин. рост человека, пикс', type: 'number', def: 80 },
      { key: 'cooldown_seconds', label: 'Пауза по человеку, сек', type: 'number', def: 300 },
      { key: 'check_interval_seconds', label: 'Интервал проверки, сек', type: 'number', def: 1 },
    ],
  },
  pose: {
    label: 'Падение человека',
    note: 'Оценка позы (yolov8-pose): критическое событие «Падение человека». '
      + 'Наклон и присед не считаются падением — проверяется ось всего тела '
      + '(плечи→стопы), ширина силуэта и время нахождения на полу. Если всё '
      + 'равно ловит наклоны — поднимите «Мин. время на полу» и «Мин. ширину».',
    fields: [
      { key: 'fall_angle_deg', label: 'Угол тела от вертикали, °', type: 'number', def: 65 },
      { key: 'min_down_seconds', label: 'Мин. время на полу, сек', type: 'number', def: 5 },
      { key: 'min_aspect_down', label: 'Мин. ширина/высота силуэта', type: 'number', def: 0.85 },
      { key: 'min_checks_down', label: 'Проверок лёжа до события', type: 'number', def: 3 },
      { key: 'min_person_px', label: 'Мин. рост человека, пикс', type: 'number', def: 80 },
      { key: 'min_confidence', label: 'Мин. уверенность (0..1)', type: 'number', def: 0.4 },
      { key: 'cooldown_seconds', label: 'Пауза по человеку, сек', type: 'number', def: 300 },
      { key: 'check_interval_seconds', label: 'Интервал проверки, сек', type: 'number', def: 0.7 },
    ],
  },
  tamper: {
    label: 'Саботаж камеры',
    note: 'Перекрытие, ослепление, расфокус или сдвиг камеры → критическое '
      + 'событие «Камера перекрыта или сдвинута». Без нейросетей, эталон сцены '
      + 'строится сам. Резкая смена день/ночь может дать одно срабатывание.',
    fields: [
      { key: 'min_checks', label: 'Проверок подряд до события', type: 'number', def: 8 },
      { key: 'check_interval_seconds', label: 'Интервал проверки, сек', type: 'number', def: 1 },
      { key: 'scene_threshold', label: 'Порог сходства сцены (0..1)', type: 'number', def: 0.35 },
      { key: 'cooldown_seconds', label: 'Пауза по камере, сек', type: 'number', def: 600 },
    ],
  },
  heatmap: {
    label: 'Тепловая карта',
    note: 'Накопление маршрутов людей по каждой камере (сетка поверх кадра). '
      + 'Смотреть — на странице «Аналитика». Данные хранятся 8 дней.',
    fields: [
      { key: 'include_staff', label: 'Учитывать сотрудников', type: 'bool', def: true },
    ],
  },
  vlm: {
    label: 'ИИ-описания событий',
    note: 'Локальная VLM-модель (Ollama, на нашем сервере — кадры никуда не '
      + 'уходят) описывает кадр события человеческим языком: описание попадает '
      + 'в Telegram-алерт и в журнал событий. После N пометок «ложное» по '
      + 'камере+типу ИИ начинает проверять такие события по кадру и не шлёт '
      + 'неподтверждённые оповещения (событие остаётся в журнале). Модель '
      + 'по умолчанию qwen3-vl:4b; первая генерация после простоя дольше.',
    fields: [
      { key: 'verify', label: 'Проверять перед оповещением', type: 'bool', def: true },
      { key: 'auto_verify_after', label: '…или после N ложных', type: 'number', def: 3 },
      {
        key: 'min_severity', label: 'Описывать события от уровня', type: 'select', def: 'warn',
        options: [
          { value: 'info', label: 'Все (включая информационные)' },
          { value: 'warn', label: 'Предупреждения и выше' },
          { value: 'critical', label: 'Только критические' },
        ],
      },
    ],
  },
  face_id: { label: 'Распознавание лиц', note: 'В разработке: требует серверной модели + согласие по 152-ФЗ.', fields: [] },
}

// Analyzer-side model state → RU chip
const STATE_LABELS: Record<string, { text: string; cls: string }> = {
  active: { text: 'Работает', cls: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300' },
  off: { text: 'Выключен', cls: 'border-zinc-500/30 bg-zinc-500/15 text-zinc-300' },
  error: { text: 'Ошибка', cls: 'border-red-500/30 bg-red-500/15 text-red-300' },
  vram_exceeded: { text: 'Не хватает VRAM', cls: 'border-amber-500/30 bg-amber-500/15 text-amber-300' },
}

function StatusChip({ status }: { status: PluginStatus | undefined }): React.JSX.Element | null {
  if (!status) return null
  const s = STATE_LABELS[status.state] ?? { text: status.state, cls: STATE_LABELS.off!.cls }
  return (
    <span className="flex items-center gap-2 text-xs">
      <span className={cn('rounded-full border px-2 py-0.5', s.cls)}>{s.text}</span>
      {status.vram_mb !== null && status.state === 'active' && (
        <span className="text-muted-foreground">{Math.round(status.vram_mb)} МБ VRAM</span>
      )}
      {status.error && <span className="text-red-400">{status.error}</span>}
    </span>
  )
}

/** Where the local-VLM chain stands: container → Ollama → pulled model. */
function VlmHealth({ s }: { s: VlmStatus | undefined }): React.JSX.Element | null {
  const probe = useMutation<VlmTest>({ mutationFn: testVlm })
  if (!s) return null
  const problems: string[] = []
  if (!s.workerAlive) problems.push('контейнер worker-ai не запущен')
  if (!s.ollamaOk) problems.push(`Ollama недоступна${s.ollamaError ? ` (${s.ollamaError})` : ''}`)
  else if (!s.modelPresent) {
    problems.push(`модель ${s.model} не загружена`
      + (s.models.length > 0 ? `; есть: ${s.models.join(', ')}` : '; список моделей пуст'))
  }
  const ok = problems.length === 0
  return (
    <div className="mt-2 space-y-1 rounded-md border border-border/60 bg-background/40 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-full border px-2 py-0.5',
          ok ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
             : 'border-red-500/30 bg-red-500/15 text-red-300')}>
          {ok ? 'ИИ на связи' : 'ИИ не работает'}
        </span>
        <span className="text-muted-foreground">модель {s.model}</span>
        {!s.enabled && <span className="text-amber-400">функция выключена</span>}
        <Button
          size="sm" variant="outline" className="ml-auto h-7"
          disabled={probe.isPending}
          onClick={() => probe.mutate()}
          title="Один реальный запрос к модели: проверяет цепочку и скорость ответа"
        >
          {probe.isPending ? 'Проверяю…' : 'Проверить ИИ'}
        </Button>
      </div>
      {probe.data && (
        <p className={probe.data.ok && probe.data.ms < 20_000 ? 'text-emerald-400' : 'text-amber-400'}>
          {probe.data.ok
            ? `Ответ за ${(probe.data.ms / 1000).toFixed(1)} с: «${probe.data.answer}»`
              + (probe.data.ms > 20_000
                ? ' — медленно: при загруженной видеопамяти проверка событий может не успевать'
                : '')
            : `Модель не ответила за ${(probe.data.ms / 1000).toFixed(1)} с: ${probe.data.error ?? ''}`}
        </p>
      )}
      {probe.isError && <p className="text-red-400">{errorMessage(probe.error)}</p>}
      {!ok && (
        <p className="text-red-400">
          {problems.join(' · ')}
          {!s.ollamaOk || s.modelPresent ? '' : ' — выполните на сервере: '}
          {!s.ollamaOk || s.modelPresent ? '' : (
            <span className="font-mono">
              docker compose -f infra/docker-compose.prod.yml exec ollama ollama pull {s.model}
            </span>
          )}
        </p>
      )}
      <p className="text-muted-foreground">
        Обработано событий: {s.stats.jobs} · описано: {s.stats.described} ·
        подтверждено: {s.stats.verified} · отсеяно: {s.stats.suppressed} ·
        кадр устарел: {s.stats.stale} · пропущено из-за очереди: {s.stats.skipped} ·
        сбоев: {s.stats.failed}
      </p>
      {s.stats.suppressed > 10 && s.stats.suppressed > s.stats.verified * 5 && (
        <p className="text-amber-400">
          ИИ отклоняет почти все события. Обычно это значит, что событий слишком
          много и кадр к моменту проверки уже не тот — уменьшите поток событий
          (пауза оповещения в настройках зоны), иначе полезные оповещения тоже
          не дойдут.
        </p>
      )}
      {s.stats.lastError && (
        <p className="text-amber-400">Последняя ошибка: {s.stats.lastError}</p>
      )}
      <p className="text-muted-foreground">
        {s.verify
          ? 'Проверка включена для всех проверяемых по кадру событий.'
          : `Проверка включается по камере+типу после ${s.autoVerifyAfter} пометок «ложное».`}
        {' '}При недоступности ИИ оповещения уходят без проверки (чтобы не потерять реальные).
      </p>
    </div>
  )
}

function FeatureCard(
  { feature, meta, current, status, extra, onSaved }:
  { feature: string; meta: FeatureMeta; current: Feature | undefined
    status: PluginStatus | undefined; extra?: React.ReactNode; onSaved: () => void },
): React.JSX.Element {
  const [enabled, setEnabled] = useState(current?.enabled ?? false)
  const [vals, setVals] = useState<Record<string, string | boolean>>(() => {
    const o: Record<string, string | boolean> = {}
    for (const f of meta.fields) {
      const cur = current?.config?.[f.key]
      o[f.key] = f.type === 'bool'
        ? (typeof cur === 'boolean' ? cur : Boolean(f.def))
        : (cur !== undefined && cur !== null ? String(cur) : String(f.def))
      if (f.type === 'select' && !f.options?.some((op) => op.value === o[f.key])) {
        o[f.key] = String(f.def) // stale/unknown value → fall back to the default
      }
    }
    return o
  })

  const save = useMutation({
    mutationFn: () => {
      const config: Record<string, unknown> = {}
      for (const f of meta.fields) {
        const v = vals[f.key]
        if (f.type === 'bool') config[f.key] = Boolean(v)
        else if (f.type === 'select') config[f.key] = String(v)
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
        <StatusChip status={status} />
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
      {extra}

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
              ) : f.type === 'select' ? (
                <Select
                  value={String(vals[f.key] ?? '')}
                  onValueChange={(v) => setVals((s) => ({ ...s, [f.key]: v }))}
                >
                  <SelectTrigger className="h-9 w-64 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(f.options ?? []).map((op) => (
                      <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
        {save.isError && <span className="text-xs text-red-400">{errorMessage(save.error)}</span>}
      </div>
    </div>
  )
}

export default function AdminFeaturesPage(): React.JSX.Element {
  const qc = useQueryClient()
  const features = useQuery({ queryKey: ['admin', 'features'], queryFn: getFeatures })
  const status = useQuery({
    queryKey: ['admin', 'feature-status'],
    queryFn: getFeatureStatus,
    refetchInterval: 15_000,
  })
  const vlm = useQuery({
    queryKey: ['admin', 'vlm-status'],
    queryFn: getVlmStatus,
    refetchInterval: 20_000,
  })
  const onSaved = (): void => void qc.invalidateQueries({ queryKey: ['admin', 'features'] })
  const m = status.data?.metrics

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
      {m && (
        <p className="text-xs text-muted-foreground">
          Анализатор: инференс {m.infer_ms ?? '—'} мс · камер {m.cameras ?? '—'}
          {m.vram_allocated_mb !== undefined && m.vram_total_mb !== undefined && (
            <> · VRAM {Math.round(m.vram_allocated_mb / 1000 * 10) / 10} / {Math.round(m.vram_total_mb / 1000 * 10) / 10} ГБ</>
          )}
          {m.detector && <> · детектор <span className="font-mono">{m.detector}</span></>}
        </p>
      )}
      {status.data && !m && (
        <p className="text-xs text-amber-400">
          Анализатор не отвечает: статусы моделей и метрики недоступны.
        </p>
      )}

      <div className="grid gap-3">
        {/* cards mount only after the list loads: FeatureCard seeds its local
            state from `current` once, so mounting early froze every toggle
            at «Выключено» regardless of the DB state */}
        {!features.data && <p className="text-sm text-muted-foreground">Загрузка…</p>}
        {features.data && Object.entries(FEATURE_META).map(([feature, meta]) => (
          <FeatureCard
            key={feature}
            feature={feature}
            meta={meta}
            current={features.data.find((f) => f.feature === feature)}
            status={status.data?.items.find((s) => s.feature_id === feature)}
            extra={feature === 'vlm' ? <VlmHealth s={vlm.data} /> : undefined}
            onSaved={onSaved}
          />
        ))}
      </div>
    </main>
  )
}
