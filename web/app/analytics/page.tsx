'use client'

import type * as React from 'react'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { IconChartHistogram } from '@tabler/icons-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { getAnalyticsOverview, getOccupancy } from '@/lib/api'
import { eventTypeLabels } from '@/lib/labels'

type Period = 'day' | 'week' | 'month'

// palette tuned to the operator-console theme (teal brand + calm accents)
const TYPE_COLORS: Record<string, string> = {
  zone_entry: 'hsl(172 55% 42%)',
  zone_exit: 'hsl(172 30% 30%)',
  zone_violation: 'hsl(0 65% 52%)',
  queue_alert: 'hsl(38 85% 55%)',
  ppe_violation: 'hsl(0 45% 40%)',
  repack_event: 'hsl(200 60% 50%)',
  shelf_violation: 'hsl(280 40% 55%)',
  crowd: 'hsl(48 70% 48%)',
  unknown_person: 'hsl(330 50% 50%)',
  camera_offline: 'hsl(15 70% 50%)',
  camera_online: 'hsl(150 45% 42%)',
  fall_detected: 'hsl(355 75% 45%)',
}
const FALLBACK_COLOR = 'hsl(215 15% 50%)'

function typeLabel(t: string): string {
  return (eventTypeLabels as Record<string, string>)[t] ?? t
}

function rangeFor(p: Period): { from: string; to: string; bucket: 'hour' | 'day' } {
  const now = new Date()
  if (p === 'day') {
    const from = new Date(now); from.setHours(0, 0, 0, 0)
    return { from: from.toISOString(), to: now.toISOString(), bucket: 'hour' }
  }
  const days = p === 'week' ? 7 : 30
  const from = new Date(now.getTime() - days * 86_400_000)
  return { from: from.toISOString(), to: now.toISOString(), bucket: 'day' }
}

function StatCard({ label, value, tone }: {
  label: string; value: React.ReactNode; tone?: 'critical' | 'warn' | undefined
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border/70 bg-card/40 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={
        tone === 'critical' ? 'font-display text-2xl font-semibold tabular-nums text-red-400'
          : tone === 'warn' ? 'font-display text-2xl font-semibold tabular-nums text-amber-400'
            : 'font-display text-2xl font-semibold tabular-nums'
      }>
        {value}
      </div>
    </div>
  )
}

/** Simple proportional bar row (calmer than another chart) */
function BarRow({ label, count, max, color }: {
  label: string; count: number; max: number; color?: string
}): React.JSX.Element {
  const pct = max > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="w-44 truncate text-sm">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded bg-border/30">
        <div
          className="h-full rounded"
          style={{ width: `${pct}%`, background: color ?? 'hsl(172 55% 42%)' }}
        />
      </div>
      <span className="w-10 text-right text-sm tabular-nums text-muted-foreground">{count}</span>
    </div>
  )
}

export default function AnalyticsPage(): React.JSX.Element {
  const [period, setPeriod] = useState<Period>('day')
  const range = useMemo(() => rangeFor(period), [period])

  const overview = useQuery({
    queryKey: ['analytics', range],
    queryFn: () => getAnalyticsOverview(range),
    refetchInterval: 60_000,
  })
  const occupancy = useQuery({ queryKey: ['occupancy'], queryFn: getOccupancy, refetchInterval: 15_000 })

  // per-site visitors (deduped across cameras by reid when enabled)
  const visitorsToday = (occupancy.data?.sites ?? []).reduce((s, o) => s + o.visitors, 0)

  // pivot: [{bucket, <type>: count, ...}] for the stacked bar chart
  const { chartData, presentTypes } = useMemo(() => {
    const rows = overview.data?.series ?? []
    const types = [...new Set(rows.map((r) => r.type))]
    const byBucket = new Map<string, Record<string, number | string>>()
    for (const r of rows) {
      const entry = byBucket.get(r.bucket) ?? { bucket: r.bucket }
      entry[r.type] = r.count
      byBucket.set(r.bucket, entry)
    }
    return {
      chartData: [...byBucket.values()],
      presentTypes: types,
    }
  }, [overview.data])

  const fmtTick = (iso: string): string => {
    const d = new Date(iso)
    return range.bucket === 'hour'
      ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  }

  const totals = overview.data?.totals ?? { total: 0, critical: 0, unresolved: 0 }
  const byType = overview.data?.byType ?? []
  const byCamera = overview.data?.byCamera ?? []
  const maxType = Math.max(1, ...byType.map((t) => t.count))
  const maxCam = Math.max(1, ...byCamera.map((c) => c.count))

  return (
    <main className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <IconChartHistogram className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Аналитика</h1>
        <div className="ml-auto">
          <ToggleGroup type="single" value={period} onValueChange={(v) => v && setPeriod(v as Period)}>
            <ToggleGroupItem value="day">Сегодня</ToggleGroupItem>
            <ToggleGroupItem value="week">7 дней</ToggleGroupItem>
            <ToggleGroupItem value="month">30 дней</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard label="Событий за период" value={totals.total} />
        <StatCard label="Критичных" value={totals.critical} tone={totals.critical > 0 ? 'critical' : undefined} />
        <StatCard label="Необработанных" value={totals.unresolved} tone={totals.unresolved > 0 ? 'warn' : undefined} />
        <StatCard label="Посетителей сегодня" value={visitorsToday} />
      </div>

      <section className="rounded-lg border border-border/70 bg-card/40 p-4">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          События по {range.bucket === 'hour' ? 'часам' : 'дням'}
        </h2>
        {chartData.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            За выбранный период событий нет.
          </p>
        ) : (
          <>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <XAxis
                    dataKey="bucket" tickFormatter={fmtTick}
                    stroke="hsl(215 16% 42%)" fontSize={11} tickLine={false} axisLine={false}
                  />
                  <YAxis
                    stroke="hsl(215 16% 42%)" fontSize={11} tickLine={false} axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'hsl(215 20% 50% / 0.08)' }}
                    labelFormatter={(v) => fmtTick(String(v))}
                    formatter={(value, name) => [String(value), typeLabel(String(name))]}
                    contentStyle={{
                      background: 'hsl(222 24% 9%)', border: '1px solid hsl(215 20% 25%)',
                      borderRadius: 8, fontSize: 12,
                    }}
                    itemStyle={{ color: 'hsl(210 22% 92%)' }}
                    labelStyle={{ color: 'hsl(215 16% 62%)' }}
                  />
                  {presentTypes.map((t) => (
                    <Bar key={t} dataKey={t} stackId="events"
                      fill={TYPE_COLORS[t] ?? FALLBACK_COLOR} radius={[2, 2, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {presentTypes.map((t) => (
                <span key={t} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLORS[t] ?? FALLBACK_COLOR }} />
                  {typeLabel(t)}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border/70 bg-card/40 p-4">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">По типам событий</h2>
          {byType.length === 0
            ? <p className="text-sm text-muted-foreground">Нет данных.</p>
            : (
              <div className="space-y-2">
                {byType.map((t) => (
                  <BarRow key={t.type} label={typeLabel(t.type)} count={t.count}
                    max={maxType} color={TYPE_COLORS[t.type] ?? FALLBACK_COLOR} />
                ))}
              </div>
            )}
        </section>

        <section className="rounded-lg border border-border/70 bg-card/40 p-4">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Камеры с наибольшей активностью</h2>
          {byCamera.length === 0
            ? <p className="text-sm text-muted-foreground">Нет данных.</p>
            : (
              <div className="space-y-2">
                {byCamera.map((c) => (
                  <BarRow key={c.camera_id} label={c.camera_name} count={c.count} max={maxCam} />
                ))}
              </div>
            )}
        </section>
      </div>
    </main>
  )
}
