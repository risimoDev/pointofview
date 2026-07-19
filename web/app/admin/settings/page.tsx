'use client'

import type * as React from 'react'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { IconSettings, IconServer } from '@tabler/icons-react'
import {
  getServerSettings, saveServerSettings, getSystemInfo,
  type ServerSetting, type SystemInfo,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const GROUP_LABELS: Record<string, string> = {
  cameras: 'Камеры',
  archive: 'Видеоархив',
  events: 'События',
  clips: 'Клипы',
  alerts: 'Уведомления',
}
const GROUP_ORDER = ['cameras', 'archive', 'events', 'clips', 'alerts']

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} ГБ`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} МБ`
  return `${Math.round(n / 1024)} КБ`
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d > 0 ? `${d} д ${h} ч` : h > 0 ? `${h} ч ${m} мин` : `${m} мин`
}

function Stat({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border/70 bg-card/40 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function DiskBar({ info }: { info: SystemInfo }): React.JSX.Element | null {
  if (!info.archiveDisk) return null
  const { totalGb, freeGb } = info.archiveDisk
  const usedPct = totalGb > 0 ? Math.min(100, Math.round(((totalGb - freeGb) / totalGb) * 100)) : 0
  return (
    <div className="rounded-lg border border-border/70 bg-card/40 px-4 py-3">
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span>Диск архива</span>
        <span>свободно {freeGb.toFixed(1)} из {totalGb.toFixed(1)} ГБ</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-border/60">
        <div
          className={usedPct >= 90 ? 'h-full bg-red-500' : usedPct >= 75 ? 'h-full bg-amber-500' : 'h-full bg-brand'}
          style={{ width: `${usedPct}%` }}
        />
      </div>
    </div>
  )
}

function SettingField({ s, value, onChange }: {
  s: ServerSetting
  value: string | boolean
  onChange: (v: string | boolean) => void
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <Label>{s.label}</Label>
      {s.type === 'boolean' ? (
        <Button
          type="button" size="sm" variant={value ? 'default' : 'outline'} className="block w-24"
          onClick={() => onChange(!value)}
        >
          {value ? 'Да' : 'Нет'}
        </Button>
      ) : s.type === 'secret' ? (
        <Input
          type="password"
          placeholder={typeof s.value === 'string' && s.value !== '' ? 'установлен (•••••)' : 'не задан'}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-72"
          autoComplete="off"
        />
      ) : s.type === 'text' ? (
        <Input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-72"
        />
      ) : (
        <Input
          type="number" step="any"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="w-40"
        />
      )}
      {s.hint && <p className="max-w-md text-xs text-muted-foreground">{s.hint}</p>}
    </div>
  )
}

export default function AdminSettingsPage(): React.JSX.Element {
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: getServerSettings })
  const system = useQuery({
    queryKey: ['admin', 'system'], queryFn: getSystemInfo, refetchInterval: 30_000,
  })

  // local edit buffer: key -> value (string for inputs, boolean for toggles)
  const [vals, setVals] = useState<Record<string, string | boolean>>({})
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!settings.data) return
    const o: Record<string, string | boolean> = {}
    for (const s of settings.data) {
      o[s.key] = s.type === 'boolean' ? Boolean(s.value)
        : s.type === 'secret' ? '' // never prefill secrets
          : String(s.value)
    }
    setVals(o)
  }, [settings.data])

  const save = useMutation({
    mutationFn: () => {
      const patch: Record<string, unknown> = {}
      for (const s of settings.data ?? []) {
        const v = vals[s.key]
        if (v === undefined) continue
        if (s.type === 'boolean') {
          if (v !== Boolean(s.value)) patch[s.key] = Boolean(v)
        } else if (s.type === 'secret') {
          if (typeof v === 'string' && v !== '') patch[s.key] = v
        } else if (s.type === 'text') {
          if (typeof v === 'string' && v !== String(s.value)) patch[s.key] = v
        } else {
          const n = Number(v)
          if (!Number.isNaN(n) && n !== Number(s.value)) patch[s.key] = n
        }
      }
      return saveServerSettings(patch)
    },
    onSuccess: () => {
      setMsg('Сохранено. Изменения применяются в течение минуты.')
      void qc.invalidateQueries({ queryKey: ['admin', 'settings'] })
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : 'Ошибка сохранения'),
  })

  const groups = GROUP_ORDER
    .map((g) => ({ id: g, items: (settings.data ?? []).filter((s) => s.group === g) }))
    .filter((g) => g.items.length > 0)

  return (
    <main className="space-y-6">
      <div className="flex items-center gap-2">
        <IconSettings className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Настройки сервера</h1>
      </div>

      {/* System panel */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <IconServer className="h-4 w-4" stroke={1.75} /> Состояние
        </h2>
        {system.data && (
          <div className="space-y-2">
            <DiskBar info={system.data} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="архив: записей" value={system.data.archive.segments.toLocaleString('ru-RU')} />
              <Stat label="архив: объём" value={fmtBytes(system.data.archive.bytes)} />
              <Stat label="событий в БД" value={system.data.eventCount.toLocaleString('ru-RU')} />
              <Stat label="размер БД" value={fmtBytes(system.data.dbSizeBytes)} />
            </div>
            <p className="text-xs text-muted-foreground">
              API работает {fmtUptime(system.data.uptimeSec)}
              {system.data.archive.oldest &&
                ` · архив с ${new Date(system.data.archive.oldest).toLocaleString('ru-RU')}`}
            </p>
            {system.data.lastBackup ? (
              system.data.lastBackup.ok ? (
                <p className="text-xs text-muted-foreground">
                  Последний бэкап:{' '}
                  {new Date(system.data.lastBackup.ts * 1000).toLocaleString('ru-RU')}
                  {system.data.lastBackup.pg_bytes !== undefined &&
                    ` · БД ${fmtBytes(system.data.lastBackup.pg_bytes)}`}
                  {system.data.lastBackup.redis_bytes !== undefined &&
                    ` · Redis ${fmtBytes(system.data.lastBackup.redis_bytes)}`}
                  {Date.now() / 1000 - system.data.lastBackup.ts > 2 * 86_400 && (
                    <span className="text-amber-400"> — старше двух суток, проверь cron</span>
                  )}
                </p>
              ) : (
                <p className="text-xs text-red-400">
                  Последний бэкап завершился ошибкой — смотри /var/log/viziai-backup.log
                </p>
              )
            ) : (
              <p className="text-xs text-amber-400">
                Бэкапы не настроены: на сервере выполни sudo ./scripts/install-backup-cron.sh
              </p>
            )}
          </div>
        )}
      </section>

      {/* Settings groups */}
      {groups.map((g) => (
        <section key={g.id} className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">{GROUP_LABELS[g.id] ?? g.id}</h2>
          <div className="flex flex-wrap gap-x-8 gap-y-4 rounded-lg border border-border/70 bg-card/40 p-4">
            {g.items.map((s) => (
              <SettingField
                key={s.key}
                s={s}
                value={vals[s.key] ?? (s.type === 'boolean' ? false : '')}
                onChange={(v) => setVals((prev) => ({ ...prev, [s.key]: v }))}
              />
            ))}
          </div>
        </section>
      ))}

      <div className="flex items-center gap-3">
        <Button disabled={save.isPending || !settings.data} onClick={() => save.mutate()}>
          Сохранить настройки
        </Button>
        {msg && <span className="text-sm text-brand">{msg}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        Значения хранятся в базе и имеют приоритет над файлом .env на сервере.
        Пустой токен Telegram означает «использовать токен из .env».
      </p>
    </main>
  )
}
