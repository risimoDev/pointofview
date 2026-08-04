import type IORedis from 'ioredis'
import { and, asc, count, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { db } from './db/client.js'
import { camera, event, site } from '../db/schema.js'
import { TYPE_LABELS } from './event_labels.js'
import { allTenantSettings, type TenantSettings } from './tenant_settings.js'

/**
 * Scheduled Telegram summaries: the evening report of the day, and the
 * pre-shift camera check.
 *
 * Both exist for the same reason: a report you have to go and fetch is a
 * report nobody reads. The evening one shows the owner what the system did
 * today; the morning one answers the question that silently ruins
 * installations — «did it actually see anything yesterday, and can it see
 * now?» A site whose camera was knocked sideways a month ago looks exactly
 * like a site with no violations.
 */

export interface SummaryDeps {
  redis: IORedis
  send: (chatId: string, text: string) => Promise<void>
  log: (msg: string, extra?: unknown) => void
}

/** HH:MM in the given timezone. */
function localHhmm(tz: string, now: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now)
}

/** YYYY-MM-DD in the given timezone — the key a "once per local day" guard needs. */
function localDay(tz: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
  return parts
}

/** Offset of `tz` from UTC at this instant, in ms (wall clock minus real time). */
function tzOffsetMs(tz: string, date: Date): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map((x) => [x.type, x.value]))
  // ICU renders midnight as "24" in some versions with hour12:false
  const wall = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  )
  return wall - (date.getTime() - date.getMilliseconds())
}

/** Start of the current local day, as an absolute instant.
 *
 *  Deliberately not "subtract the hours elapsed today": across a daylight
 *  saving change the local day is 23 or 25 hours long, and that arithmetic
 *  lands an hour out — on a spring-forward day it lands in the previous day
 *  entirely, silently pulling yesterday's events into today's summary.
 *
 *  Instead: take the local calendar date, place midnight on it, and solve for
 *  the instant using the offset in force there (iterated, because the offset
 *  depends on the very instant being solved for). Where local midnight does
 *  not exist at all — zones that shift the clock at 00:00 — step forward to
 *  the first instant that does belong to the day. */
function localDayStart(tz: string, now: Date): Date {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map((x) => [x.type, x.value]))
  const midnightWall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))
  let ts = midnightWall - tzOffsetMs(tz, now)
  for (let i = 0; i < 2; i++) ts = midnightWall - tzOffsetMs(tz, new Date(ts))
  const target = `${p.year}-${p.month}-${p.day}`
  for (let i = 0; i < 3 && localDay(tz, new Date(ts)) < target; i++) ts += 3_600_000
  return new Date(ts)
}

/** The organisation's clock. A tenant with several sites uses the oldest one —
 *  a daily summary is org-level and has to pick a single day boundary. */
async function tenantTimezone(tenantId: string): Promise<string | null> {
  const [row] = await db.select({ tz: site.timezone })
    .from(site).where(eq(site.tenantId, tenantId)).orderBy(asc(site.id)).limit(1)
  return row?.tz ?? null
}

/** Send at most once per local day, and only after the configured time.
 *
 *  The day is claimed in Redis BEFORE sending so two ticks (or two replicas)
 *  cannot both send, and released again if the send fails — otherwise one
 *  transient Telegram error would silently cost the whole day's report. The
 *  TTL outlives a day so a worker restart cannot re-send either. */
async function sendOncePerDay(
  deps: SummaryDeps, kind: string, tenantId: string, tz: string, at: string, now: Date,
  build: () => Promise<{ chatId: string; text: string }>,
): Promise<boolean> {
  if (localHhmm(tz, now) < at) return false
  const key = `summary:sent:${kind}:${tenantId}:${localDay(tz, now)}`
  const claimed = await deps.redis.set(key, '1', 'EX', 2 * 86_400, 'NX')
  if (claimed !== 'OK') return false
  try {
    const { chatId, text } = await build()
    await deps.send(chatId, text)
    return true
  } catch (err) {
    await deps.redis.del(key).catch(() => undefined) // retry on the next tick
    throw err
  }
}

function fmt(n: number): string {
  return String(n)
}

async function dailySummary(
  tenantId: string, tz: string, now: Date,
): Promise<string> {
  const from = localDayStart(tz, now)

  const byType = await db.select({
    type: event.type, n: count(),
  }).from(event)
    .where(and(
      eq(event.tenantId, tenantId),
      gte(event.tsStart, from),
      lt(event.tsStart, now),
      eq(event.falsePositive, false),
    ))
    .groupBy(event.type)
    .orderBy(desc(count()))

  const [totals] = await db.select({
    total: count(),
    critical: sql<number>`count(*) filter (where ${event.severity} = 'critical')`,
    unresolved: sql<number>`count(*) filter (where ${event.resolved} = false)`,
    falsePositives: sql<number>`count(*) filter (where ${event.falsePositive} = true)`,
  }).from(event)
    .where(and(
      eq(event.tenantId, tenantId),
      gte(event.tsStart, from),
      lt(event.tsStart, now),
    ))

  const dateLabel = new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz, dateStyle: 'long',
  }).format(now)

  const lines = [`📋 <b>Сводка за ${dateLabel}</b>`]
  const real = Number(totals?.total ?? 0) - Number(totals?.falsePositives ?? 0)
  if (real === 0) {
    lines.push('Нарушений не зафиксировано.')
  } else {
    for (const r of byType) {
      lines.push(`• ${TYPE_LABELS[r.type] ?? r.type}: ${fmt(Number(r.n))}`)
    }
    lines.push('')
    lines.push(`Критичных: ${fmt(Number(totals?.critical ?? 0))}`)
    lines.push(`Не разобрано: ${fmt(Number(totals?.unresolved ?? 0))}`)
  }
  if (Number(totals?.falsePositives ?? 0) > 0) {
    lines.push(`Отмечено ложными: ${fmt(Number(totals?.falsePositives ?? 0))}`)
  }
  return lines.join('\n')
}

async function shiftCheck(
  tenantId: string, tz: string, now: Date, redis: IORedis,
): Promise<string> {
  const cams = await db.select({ id: camera.id, name: camera.name, sourceType: camera.sourceType })
    .from(camera)
    .innerJoin(site, eq(camera.siteId, site.id))
    .where(eq(site.tenantId, tenantId))
    .orderBy(asc(camera.name))

  // Same source of truth as GET /cameras: the analyzer heartbeat, not the
  // status column (which is a manual override for the sticky error state).
  const alive = cams.length > 0
    ? await redis.mget(cams.map((c) => `camera_alive:${c.id}`))
    : []
  const offline = cams.filter((c, i) => c.sourceType !== 'file' && !alive[i])

  const since = new Date(now.getTime() - 24 * 3_600_000)
  const tampered = await db.select({ name: camera.name, n: count() })
    .from(event)
    .innerJoin(camera, eq(event.cameraId, camera.id))
    .where(and(
      eq(event.tenantId, tenantId),
      eq(event.type, 'camera_tampered'),
      gte(event.tsStart, since),
      eq(event.falsePositive, false),
    ))
    .groupBy(camera.name)

  const lines = [`🔍 <b>Проверка перед сменой</b>`]
  lines.push(`Камеры: ${fmt(cams.length - offline.length)} из ${fmt(cams.length)} на связи`)
  if (offline.length > 0) {
    lines.push('')
    lines.push('<b>Не отвечают:</b>')
    for (const c of offline.slice(0, 20)) lines.push(`• ${c.name}`)
  }
  if (tampered.length > 0) {
    lines.push('')
    lines.push('<b>Обзор изменился за сутки:</b>')
    for (const t of tampered) lines.push(`• ${t.name} (${fmt(Number(t.n))})`)
  }

  const backupRaw = await redis.get('backup:last')
  if (backupRaw) {
    try {
      const b = JSON.parse(backupRaw) as { ts?: string; ok?: boolean }
      const ts = b.ts ? Date.parse(b.ts) : NaN
      const ageH = Number.isFinite(ts) ? Math.round((now.getTime() - ts) / 3_600_000) : null
      if (b.ok === false) lines.push('', '⚠️ Последняя резервная копия завершилась с ошибкой')
      else if (ageH !== null && ageH > 36) lines.push('', `⚠️ Резервной копии нет ${fmt(ageH)} ч`)
    } catch { /* malformed status: not worth failing the report over */ }
  }

  if (offline.length === 0 && tampered.length === 0) {
    lines.push('')
    lines.push('Все камеры на связи, обзор не менялся.')
  }
  return lines.join('\n')
}

/** One tick. Called on a timer; safe to call more often than the schedules. */
export async function runScheduledSummaries(deps: SummaryDeps): Promise<void> {
  const now = new Date()
  for (const t of await allTenantSettings()) {
    const s: TenantSettings = t.settings
    if (!s.summary_chat_id) continue
    if (!s.daily_summary_at && !s.shift_check_at) continue

    const tz = await tenantTimezone(t.id)
    if (!tz) continue

    const chatId = s.summary_chat_id
    try {
      if (s.daily_summary_at) {
        const sent = await sendOncePerDay(
          deps, 'daily', t.id, tz, s.daily_summary_at, now,
          async () => ({ chatId, text: await dailySummary(t.id, tz, now) }),
        )
        if (sent) deps.log('daily summary sent', { tenantId: t.id })
      }
      if (s.shift_check_at) {
        const sent = await sendOncePerDay(
          deps, 'shift', t.id, tz, s.shift_check_at, now,
          async () => ({ chatId, text: await shiftCheck(t.id, tz, now, deps.redis) }),
        )
        if (sent) deps.log('shift check sent', { tenantId: t.id })
      }
    } catch (err) {
      deps.log('scheduled summary failed', {
        tenantId: t.id, error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
