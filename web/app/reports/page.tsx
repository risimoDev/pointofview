'use client'

import type * as React from 'react'
import { useMemo, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  IconFileAnalytics, IconFileTypePdf, IconTable, IconBrandTelegram,
} from '@tabler/icons-react'
import {
  getSafetyReport, getSites, downloadSafetyReport, sendSafetyReportTelegram, errorMessage,
} from '@/lib/api'
import { eventTypeLabels, labelOf } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

const ALL_SITES = '__all__'

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return isoDay(d)
}

const PRESETS: { label: string; days: number }[] = [
  { label: 'Сегодня', days: 0 },
  { label: '7 дней', days: 7 },
  { label: '30 дней', days: 30 },
]

function Card({ title, value, accent }: {
  title: string; value: string; accent?: boolean
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border/70 bg-card/40 p-4">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className={cn('mt-1 font-display text-2xl font-semibold tracking-tight',
        accent && 'text-red-400')}
      >
        {value}
      </div>
    </div>
  )
}

function Table({ header, rows }: {
  header: string[]; rows: (string | number)[][]
}): React.JSX.Element {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
            {header.map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/40 last:border-0">
              {r.map((c, j) => <td key={j} className="px-3 py-1.5">{c}</td>)}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td className="px-3 py-2 text-muted-foreground" colSpan={header.length}>Нет данных</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default function ReportsPage(): React.JSX.Element {
  const [fromDay, setFromDay] = useState(daysAgo(7))
  const [toDay, setToDay] = useState(isoDay(new Date()))
  const [siteId, setSiteId] = useState(ALL_SITES)

  // [from 00:00, to+1day 00:00) in the browser's timezone
  const range = useMemo(() => {
    const from = new Date(`${fromDay}T00:00:00`)
    const to = new Date(`${toDay}T00:00:00`)
    to.setDate(to.getDate() + 1)
    return { from: from.toISOString(), to: to.toISOString() }
  }, [fromDay, toDay])

  const site = siteId === ALL_SITES ? undefined : siteId
  // sites are admin-scoped; managers just lose the selector
  const sites = useQuery({ queryKey: ['sites'], queryFn: getSites, retry: false })
  const report = useQuery({
    queryKey: ['safety-report', range.from, range.to, site],
    queryFn: () => getSafetyReport(range.from, range.to, site),
  })

  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null)
  const download = async (kind: 'pdf' | 'xlsx'): Promise<void> => {
    setBusy(kind)
    try {
      await downloadSafetyReport(kind, range.from, range.to, site)
    } finally {
      setBusy(null)
    }
  }
  const telegram = useMutation({
    mutationFn: () => sendSafetyReportTelegram(range.from, range.to, site),
  })

  const d = report.data
  const maxDay = Math.max(1, ...(d?.byDay.map((x) => x.count) ?? [1]))

  return (
    <main className="space-y-5 p-4">
      <div className="flex items-center gap-2">
        <IconFileAnalytics className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Отчёты по охране труда</h1>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.label} size="sm" variant="outline"
            onClick={() => { setFromDay(daysAgo(p.days)); setToDay(isoDay(new Date())) }}
          >
            {p.label}
          </Button>
        ))}
        <div className="space-y-1">
          <Label>С</Label>
          <Input type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} className="h-9 w-40" />
        </div>
        <div className="space-y-1">
          <Label>По (включительно)</Label>
          <Input type="date" value={toDay} onChange={(e) => setToDay(e.target.value)} className="h-9 w-40" />
        </div>
        {sites.data && sites.data.length > 1 && (
          <div className="space-y-1">
            <Label>Объект</Label>
            <Select value={siteId} onValueChange={setSiteId}>
              <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SITES}>Все объекты</SelectItem>
                {sites.data.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="ml-auto flex items-end gap-2">
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void download('pdf')}>
            <IconFileTypePdf className="mr-1 h-4 w-4" stroke={1.75} />
            {busy === 'pdf' ? 'Готовлю…' : 'PDF'}
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void download('xlsx')}>
            <IconTable className="mr-1 h-4 w-4" stroke={1.75} />
            {busy === 'xlsx' ? 'Готовлю…' : 'Excel'}
          </Button>
          <Button size="sm" disabled={telegram.isPending} onClick={() => telegram.mutate()}>
            <IconBrandTelegram className="mr-1 h-4 w-4" stroke={1.75} />
            В Telegram
          </Button>
        </div>
      </div>
      {telegram.isSuccess && <p className="text-sm text-emerald-400">Отчёт отправлен в Telegram.</p>}
      {telegram.isError && (
        <p className="text-sm text-red-400">{errorMessage(telegram.error)}</p>
      )}
      {report.isError && (
        <p className="text-sm text-red-400">{errorMessage(report.error)}</p>
      )}

      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Card title="Всего нарушений" value={String(d.totals.total)} />
            <Card title="Критичных" value={String(d.totals.critical)} accent={d.totals.critical > 0} />
            <Card title="Разобрано" value={`${d.totals.resolved} из ${d.totals.total}`} />
            <Card
              title="Среднее время реакции"
              value={d.totals.avg_resolve_min !== null ? `${d.totals.avg_resolve_min} мин` : '—'}
            />
            <Card title="Отсеяно ложных" value={String(d.totals.false_positives)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">По типам</h2>
              <Table
                header={['Тип', 'Всего', 'Критичных']}
                rows={d.byType.map((r) => [labelOf(eventTypeLabels, r.type as never), r.count, r.critical])}
              />
            </section>
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">По участкам (зонам)</h2>
              <Table
                header={['Зона', 'Всего', 'Критичных']}
                rows={d.byZone.map((r) => [r.zone_name, r.count, r.critical])}
              />
            </section>
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">Динамика по дням</h2>
            <div className="space-y-1 rounded-lg border border-border/70 p-3">
              {d.byDay.map((x) => (
                <div key={x.day} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-muted-foreground">{x.day}</span>
                  <div className="relative h-3 flex-1 overflow-hidden rounded bg-accent/40">
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-brand/70"
                      style={{ width: `${(x.count / maxDay) * 100}%` }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-red-500/80"
                      style={{ width: `${(x.critical / maxDay) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 text-right">{x.count}</span>
                </div>
              ))}
              {d.byDay.length === 0 && <p className="text-sm text-muted-foreground">Нет данных</p>}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">Последние нарушения</h2>
            <Table
              header={['Дата, время', 'Тип', 'Камера', 'Зона', 'Статус']}
              rows={d.recent.map((r) => [
                new Date(r.ts_start).toLocaleString('ru-RU', { timeZone: d.tz }),
                labelOf(eventTypeLabels, r.type as never),
                r.camera_name,
                r.zone_name ?? '—',
                r.resolved ? 'разобрано' : 'не разобрано',
              ])}
            />
            <p className="text-xs text-muted-foreground">
              Снимки и клипы каждого нарушения — в разделе «События».
            </p>
          </section>
        </>
      )}
    </main>
  )
}
