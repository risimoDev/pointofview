import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { existsSync } from 'node:fs'
import PDFDocument from 'pdfkit'
import ExcelJS from 'exceljs'
import { db } from '../db/client.js'
import { camera, event, site, zone } from '../../db/schema.js'
import { config } from '../config.js'
import { settingSecret, settingText } from '../settings.js'
import { SEVERITY_LABELS, typeLabel } from '../event_labels.js'

// Labor-safety (охрана труда) reporting: the safety service buys PROOF that
// measures were taken, not detection itself (docs/architecture/
// 14_FACTORY_MODULES.md, 9). One dataset feeds the JSON page, the PDF
// document, the Excel export and the Telegram delivery.

const SAFETY_TYPES = ['ppe_violation', 'fall_detected', 'zone_violation', 'crowd', 'lone_worker']
const DEFAULT_TZ = 'Europe/Moscow'

const ReportQuery = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  site_id: z.string().uuid().optional(),
})
type ReportQueryT = z.infer<typeof ReportQuery>

interface SafetyData {
  from: string
  to: string
  tz: string
  siteName: string | null
  generatedAt: Date
  totals: { total: number; critical: number; resolved: number; avg_resolve_min: number | null }
  byDay: { day: string; count: number; critical: number }[]
  byType: { type: string; count: number; critical: number }[]
  byZone: { zone_name: string; count: number; critical: number }[]
  byCamera: { camera_name: string; count: number }[]
  recent: {
    id: string; ts_start: string; type: string; severity: string
    camera_name: string; zone_name: string | null; resolved: boolean
  }[]
  modelVersions: string[]
}

async function collectSafetyData(tenantId: string, q: ReportQueryT): Promise<SafetyData> {
  let tz = DEFAULT_TZ
  let siteName: string | null = null
  if (q.site_id) {
    const [s] = await db.select({ name: site.name, timezone: site.timezone }).from(site)
      .where(sql`${site.id} = ${q.site_id} AND ${site.tenantId} = ${tenantId}`).limit(1)
    if (s) {
      siteName = s.name
      tz = s.timezone || DEFAULT_TZ
    }
  }
  const siteCond = q.site_id ? sql`AND ${event.siteId} = ${q.site_id}` : sql``
  const base = sql`
    FROM ${event}
    WHERE ${event.tenantId} = ${tenantId}
      AND ${event.type} = ANY(${SAFETY_TYPES})
      AND ${event.tsStart} >= ${q.from} AND ${event.tsStart} < ${q.to}
      ${siteCond}
  `

  const totals = await db.execute(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE ${event.severity} = 'critical')::int AS critical,
           count(*) FILTER (WHERE ${event.resolved})::int AS resolved,
           round(avg(EXTRACT(EPOCH FROM (${event.resolvedAt} - ${event.tsStart})) / 60)
                 FILTER (WHERE ${event.resolved} AND ${event.resolvedAt} IS NOT NULL))::int
             AS avg_resolve_min
    ${base}
  `)

  const byDay = await db.execute(sql`
    SELECT to_char(${event.tsStart} AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
           count(*)::int AS count,
           count(*) FILTER (WHERE ${event.severity} = 'critical')::int AS critical
    ${base}
    GROUP BY day ORDER BY day ASC
  `)

  const byType = await db.execute(sql`
    SELECT ${event.type} AS type, count(*)::int AS count,
           count(*) FILTER (WHERE ${event.severity} = 'critical')::int AS critical
    ${base}
    GROUP BY type ORDER BY count DESC
  `)

  const byZone = await db.execute(sql`
    SELECT coalesce(z.name, '—') AS zone_name, count(*)::int AS count,
           count(*) FILTER (WHERE e.severity = 'critical')::int AS critical
    FROM ${event} e LEFT JOIN ${zone} z ON z.id = e.zone_id
    WHERE e.tenant_id = ${tenantId}
      AND e.type = ANY(${SAFETY_TYPES})
      AND e.ts_start >= ${q.from} AND e.ts_start < ${q.to}
      ${q.site_id ? sql`AND e.site_id = ${q.site_id}` : sql``}
    GROUP BY zone_name ORDER BY count DESC LIMIT 20
  `)

  const byCamera = await db.execute(sql`
    SELECT coalesce(c.name, left(e.camera_id::text, 8)) AS camera_name, count(*)::int AS count
    FROM ${event} e LEFT JOIN ${camera} c ON c.id = e.camera_id
    WHERE e.tenant_id = ${tenantId}
      AND e.type = ANY(${SAFETY_TYPES})
      AND e.ts_start >= ${q.from} AND e.ts_start < ${q.to}
      ${q.site_id ? sql`AND e.site_id = ${q.site_id}` : sql``}
    GROUP BY camera_name ORDER BY count DESC LIMIT 10
  `)

  const recent = await db.execute(sql`
    SELECT e.id, e.ts_start, e.type, e.severity, e.resolved,
           coalesce(c.name, left(e.camera_id::text, 8)) AS camera_name,
           z.name AS zone_name
    FROM ${event} e
      LEFT JOIN ${camera} c ON c.id = e.camera_id
      LEFT JOIN ${zone} z ON z.id = e.zone_id
    WHERE e.tenant_id = ${tenantId}
      AND e.type = ANY(${SAFETY_TYPES})
      AND e.ts_start >= ${q.from} AND e.ts_start < ${q.to}
      ${q.site_id ? sql`AND e.site_id = ${q.site_id}` : sql``}
    ORDER BY e.ts_start DESC LIMIT 30
  `)

  const models = await db.execute(sql`
    SELECT DISTINCT ${event.meta}->>'model_version' AS mv
    ${base}
    AND ${event.meta} ? 'model_version' LIMIT 10
  `)

  return {
    from: q.from,
    to: q.to,
    tz,
    siteName,
    generatedAt: new Date(),
    totals: (totals.rows[0] ?? {
      total: 0, critical: 0, resolved: 0, avg_resolve_min: null,
    }) as unknown as SafetyData['totals'],
    byDay: byDay.rows as unknown as SafetyData['byDay'],
    byType: byType.rows as unknown as SafetyData['byType'],
    byZone: byZone.rows as unknown as SafetyData['byZone'],
    byCamera: byCamera.rows as unknown as SafetyData['byCamera'],
    recent: (recent.rows as unknown as (SafetyData['recent'][number] & { ts_start: Date })[])
      .map((r) => ({ ...r, ts_start: new Date(r.ts_start).toISOString() })),
    modelVersions: (models.rows as unknown as { mv: string | null }[])
      .map((r) => r.mv).filter((v): v is string => Boolean(v)),
  }
}

// ── PDF ───────────────────────────────────────────────────────
// Cyrillic needs an embedded TTF; the api image ships fonts-dejavu-core (used
// by the clips watermark), dev Windows falls back to Arial.
function findFont(bold: boolean): string | null {
  const candidates = bold
    ? [
        process.env.REPORT_FONT_BOLD ?? '',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        'C:/Windows/Fonts/arialbd.ttf',
      ]
    : [
        process.env.REPORT_FONT ?? '',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        'C:/Windows/Fonts/arial.ttf',
      ]
  return candidates.find((p) => p && existsSync(p)) ?? null
}

function fmtDate(iso: string, tz: string, withTime = false): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(iso))
}

async function buildSafetyPdf(data: SafetyData): Promise<Buffer> {
  const font = findFont(false)
  const fontBold = findFont(true) ?? font
  if (!font) throw new Error('no cyrillic-capable TTF font found on this host')

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
  })
  doc.registerFont('ru', font)
  doc.registerFont('ru-b', fontBold!)

  const W = doc.page.width - 80 // content width inside margins

  const ensureSpace = (h: number): void => {
    if (doc.y + h > doc.page.height - 60) doc.addPage()
  }
  const section = (title: string): void => {
    ensureSpace(40)
    doc.moveDown(0.8)
    doc.font('ru-b').fontSize(12).fillColor('#111').text(title)
    doc.moveDown(0.3)
  }
  const table = (widths: number[], header: string[], rows: string[][]): void => {
    const rowH = 16
    const drawRow = (cells: string[], bold: boolean): void => {
      ensureSpace(rowH + 4)
      const y = doc.y
      let x = 40
      doc.font(bold ? 'ru-b' : 'ru').fontSize(8.5).fillColor('#222')
      cells.forEach((cell, i) => {
        doc.text(cell, x + 2, y, { width: (widths[i] ?? 60) - 4, height: rowH, ellipsis: true })
        x += widths[i] ?? 60
      })
      doc.moveTo(40, y + rowH - 3).lineTo(40 + widths.reduce((a, b) => a + b, 0), y + rowH - 3)
        .strokeColor('#dddddd').lineWidth(0.5).stroke()
      doc.x = 40
      doc.y = y + rowH
    }
    drawRow(header, true)
    for (const r of rows) drawRow(r, false)
    if (rows.length === 0) {
      doc.font('ru').fontSize(8.5).fillColor('#666').text('— нет данных —')
    }
  }

  // header
  doc.font('ru-b').fontSize(18).fillColor('#111').text('Отчёт по охране труда')
  doc.moveDown(0.2)
  doc.font('ru').fontSize(10).fillColor('#444')
  doc.text(`Объект: ${data.siteName ?? 'все объекты'}`)
  doc.text(`Период: ${fmtDate(data.from, data.tz)} — ${fmtDate(data.to, data.tz)} (${data.tz})`)
  doc.text(`Сформирован: ${fmtDate(data.generatedAt.toISOString(), data.tz, true)} · ViziAI`)

  // totals
  section('Итоги периода')
  const t = data.totals
  const reacted = t.avg_resolve_min !== null ? `${t.avg_resolve_min} мин` : '—'
  table(
    [130, 130, 130, 125],
    ['Всего нарушений', 'Критичных', 'Разобрано', 'Среднее время реакции'],
    [[String(t.total), String(t.critical), `${t.resolved} из ${t.total}`, reacted]],
  )

  // by type
  section('Нарушения по типам')
  table(
    [255, 130, 130],
    ['Тип', 'Всего', 'Критичных'],
    data.byType.map((r) => [typeLabel(r.type), String(r.count), String(r.critical)]),
  )

  // by zone (участки)
  section('Нарушения по участкам (зонам)')
  table(
    [255, 130, 130],
    ['Зона', 'Всего', 'Критичных'],
    data.byZone.map((r) => [r.zone_name, String(r.count), String(r.critical)]),
  )

  // daily dynamics as simple bars
  section('Динамика по дням')
  const maxDay = Math.max(1, ...data.byDay.map((d) => d.count))
  for (const d of data.byDay) {
    ensureSpace(14)
    const y = doc.y
    doc.font('ru').fontSize(8.5).fillColor('#222').text(d.day, 40, y, { width: 70 })
    const barW = Math.max(2, (d.count / maxDay) * (W - 160))
    doc.rect(115, y + 1, barW, 8).fillColor('#2a9d8f').fill()
    if (d.critical > 0) {
      doc.rect(115, y + 1, Math.max(2, (d.critical / maxDay) * (W - 160)), 8)
        .fillColor('#c0392b').fill()
    }
    doc.fillColor('#222').text(String(d.count), 120 + barW, y, { width: 60 })
    doc.x = 40
    doc.y = y + 13
  }
  if (data.byDay.length === 0) {
    doc.font('ru').fontSize(8.5).fillColor('#666').text('— нет данных —')
  }

  // recent violations (доказательная часть — привязка к событиям в системе)
  section('Последние нарушения')
  table(
    [95, 120, 105, 105, 90],
    ['Дата, время', 'Тип', 'Камера', 'Зона', 'Статус'],
    data.recent.map((r) => [
      fmtDate(r.ts_start, data.tz, true),
      typeLabel(r.type),
      r.camera_name,
      r.zone_name ?? '—',
      r.resolved ? 'разобрано' : (SEVERITY_LABELS[r.severity] ?? r.severity),
    ]),
  )

  // footer
  doc.moveDown(1)
  doc.font('ru').fontSize(7.5).fillColor('#888')
  doc.text('К каждому нарушению в системе ViziAI привязаны снимок кадра и видеоклип (раздел «События»).')
  if (data.modelVersions.length > 0) {
    doc.text(`Модели детекции за период: ${data.modelVersions.join(', ')}`)
  }
  doc.text('Отчёт по работникам требует интеграции со СКУД предприятия — предоставляется после интеграции.')

  doc.end()
  return done
}

// ── Excel (формализованная выгрузка, в т.ч. для ГИТ) ─────────
async function buildSafetyXlsx(
  tenantId: string, q: ReportQueryT, data: SafetyData,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ViziAI'

  const summary = wb.addWorksheet('Сводка')
  summary.columns = [{ width: 40 }, { width: 16 }, { width: 16 }]
  summary.addRows([
    ['Отчёт по охране труда'],
    ['Объект', data.siteName ?? 'все объекты'],
    ['Период', `${fmtDate(data.from, data.tz)} — ${fmtDate(data.to, data.tz)}`],
    [],
    ['Всего нарушений', data.totals.total],
    ['Критичных', data.totals.critical],
    ['Разобрано', data.totals.resolved],
    ['Среднее время реакции, мин', data.totals.avg_resolve_min ?? '—'],
    [],
    ['Тип', 'Всего', 'Критичных'],
    ...data.byType.map((r) => [typeLabel(r.type), r.count, r.critical]),
    [],
    ['Зона', 'Всего', 'Критичных'],
    ...data.byZone.map((r) => [r.zone_name, r.count, r.critical]),
  ])
  summary.getRow(1).font = { bold: true, size: 14 }

  const rows = await db.execute(sql`
    SELECT e.ts_start, e.type, e.severity, e.resolved, e.resolved_at,
           coalesce(c.name, left(e.camera_id::text, 8)) AS camera_name,
           z.name AS zone_name,
           e.meta->>'model_version' AS model_version
    FROM ${event} e
      LEFT JOIN ${camera} c ON c.id = e.camera_id
      LEFT JOIN ${zone} z ON z.id = e.zone_id
    WHERE e.tenant_id = ${tenantId}
      AND e.type = ANY(${SAFETY_TYPES})
      AND e.ts_start >= ${q.from} AND e.ts_start < ${q.to}
      ${q.site_id ? sql`AND e.site_id = ${q.site_id}` : sql``}
    ORDER BY e.ts_start ASC LIMIT 5000
  `)

  const list = wb.addWorksheet('Нарушения')
  list.columns = [
    { header: 'Дата, время', width: 20 },
    { header: 'Тип', width: 24 },
    { header: 'Критичность', width: 16 },
    { header: 'Камера', width: 22 },
    { header: 'Зона', width: 22 },
    { header: 'Разобрано', width: 12 },
    { header: 'Время реакции, мин', width: 18 },
    { header: 'Модель', width: 24 },
  ]
  list.getRow(1).font = { bold: true }
  for (const r of rows.rows as unknown as {
    ts_start: Date; type: string; severity: string; resolved: boolean
    resolved_at: Date | null; camera_name: string; zone_name: string | null
    model_version: string | null
  }[]) {
    const reaction = r.resolved && r.resolved_at
      ? Math.round((new Date(r.resolved_at).getTime() - new Date(r.ts_start).getTime()) / 60_000)
      : null
    list.addRow([
      fmtDate(new Date(r.ts_start).toISOString(), data.tz, true),
      typeLabel(r.type),
      SEVERITY_LABELS[r.severity] ?? r.severity,
      r.camera_name,
      r.zone_name ?? '—',
      r.resolved ? 'да' : 'нет',
      reaction ?? '—',
      r.model_version ?? '—',
    ])
  }

  return Buffer.from(await wb.xlsx.writeBuffer())
}

function reportFilename(data: SafetyData, ext: string): string {
  const d = (iso: string): string => iso.slice(0, 10)
  return `safety_${d(data.from)}_${d(data.to)}.${ext}`
}

const reportsRoutes: FastifyPluginAsyncZod = async (app) => {
  const guard = app.requireRole('super', 'admin', 'manager')

  app.get('/reports/safety', {
    preHandler: [guard],
    schema: { querystring: ReportQuery },
  }, async (req) => collectSafetyData(req.tenantId, req.query))

  app.get('/reports/safety.pdf', {
    preHandler: [guard],
    schema: { querystring: ReportQuery },
  }, async (req, reply) => {
    const data = await collectSafetyData(req.tenantId, req.query)
    const pdf = await buildSafetyPdf(data)
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${reportFilename(data, 'pdf')}"`)
      .send(pdf)
  })

  app.get('/reports/safety.xlsx', {
    preHandler: [guard],
    schema: { querystring: ReportQuery },
  }, async (req, reply) => {
    const data = await collectSafetyData(req.tenantId, req.query)
    const xlsx = await buildSafetyXlsx(req.tenantId, req.query, data)
    return reply
      .header('Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${reportFilename(data, 'xlsx')}"`)
      .send(xlsx)
  })

  // PDF документом в Telegram (почты/SMTP пока нет; бот уже есть у алертов)
  app.post('/reports/safety/telegram', {
    preHandler: [guard],
    schema: { querystring: ReportQuery },
  }, async (req, reply) => {
    const chatId = await settingText('report_telegram_chat_id')
    const token = (await settingSecret('telegram_bot_token')) || config.TELEGRAM_BOT_TOKEN
    if (!chatId || !token) {
      return reply.code(503).send({
        message: 'Задайте «Telegram chat_id для отчётов» в настройках сервера',
      })
    }
    const data = await collectSafetyData(req.tenantId, req.query)
    const pdf = await buildSafetyPdf(data)

    const form = new FormData()
    form.append('chat_id', chatId)
    form.append('caption',
      `Отчёт по охране труда: ${fmtDate(data.from, data.tz)} — ${fmtDate(data.to, data.tz)}`
      + (data.siteName ? ` · ${data.siteName}` : ''))
    form.append('document',
      new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }),
      reportFilename(data, 'pdf'))

    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30_000),
    })
    const out = (await res.json()) as { ok: boolean; description?: string }
    if (!out.ok) {
      req.log.error({ description: out.description }, 'safety report: telegram send failed')
      return reply.code(502).send({ message: 'Не удалось отправить отчёт в Telegram' })
    }
    return { sent: true }
  })
}

export default reportsRoutes
