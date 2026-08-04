import { Worker, type Job, type ConnectionOptions } from 'bullmq'
import IORedis from 'ioredis'
import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { alertRule, camera, event, notification, site, zone } from '../../db/schema.js'
import { config } from '../config.js'
import { ALERTS_QUEUE, alertsQueue, type AlertJob } from '../queues.js'
import { minio } from '../minio.js'
import { settingNumber, settingSecret } from '../settings.js'
import { TYPE_LABELS } from '../event_labels.js'
import { ackButtons, runTelegramAckPoller } from '../telegram_ack.js'
import { allTenantSettings, getTenantSettings, inLearningMode } from '../tenant_settings.js'
import { runScheduledSummaries } from '../summaries.js'

const log = (msg: string, extra?: unknown): void => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg, extra }))
}

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴', warn: '🟡', info: 'ℹ️',
}

// human-readable RU event names for outgoing notifications — shared with the
// PDF/Excel reports (see event_labels.ts)

const SEVERITY_RANK: Record<string, number> = { info: 0, warn: 1, critical: 2 }

// How far back escalation looks. Anything older is history: after an outage
// the backlog must not be paged out at once.
const ESCALATION_LOOKBACK_HOURS = 24

// Purely infrastructural: these say the SYSTEM is broken, not that a person
// did something. Learning mode never silences them — during the first week
// «камера не в сети» is precisely what the installer needs to hear.
const INFRA_EVENT_TYPES = new Set(['camera_offline', 'camera_online'])

// channels jsonb shape (telegram + webhook dispatched; others recorded unsupported)
const TelegramChannel = z.object({ type: z.literal('telegram'), chat_id: z.union([z.string(), z.number()]) })
const WebhookChannel = z.object({ type: z.literal('webhook'), url: z.string().url() })
const Channel = z.union([TelegramChannel, WebhookChannel, z.object({ type: z.string() }).passthrough()])
const Channels = z.array(Channel)

/** True when local time (site tz) is inside the [quiet_from, quiet_to) window.
 *  Window may wrap past midnight (e.g. 22:00 → 08:00). */
function inQuietHours(schedule: Record<string, unknown>, tz: string, now: Date): boolean {
  const from = typeof schedule.quiet_from === 'string' ? schedule.quiet_from : null
  const to = typeof schedule.quiet_to === 'string' ? schedule.quiet_to : null
  if (!from || !to || from === to) return false
  const hhmm = new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now)
  return from < to
    ? hhmm >= from && hhmm < to
    : hhmm >= from || hhmm < to // wraps midnight
}

interface EventCtx {
  type: string
  severity: string
  tsStart: Date
  cameraId: string
  snapshotKey: string | null
  cameraName: string
  tz: string
  zoneName: string | null
  meta?: Record<string, unknown>
  /** null for the synthetic test message — nothing to acknowledge there */
  eventId?: string | null
}

// digest buffer entry (Redis list digest:{rule_id})
interface DigestEntry {
  type: string
  zone: string | null
  camera: string
  gid: string | null
  tz: string
  ts: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildText(ctx: EventCtx): string {
  const emoji = SEVERITY_EMOJI[ctx.severity] ?? 'ℹ️'
  const tsLocal = new Intl.DateTimeFormat('ru-RU', {
    timeZone: ctx.tz, dateStyle: 'short', timeStyle: 'medium',
  }).format(ctx.tsStart)
  // VLM scene description written by the ai worker before the alert fires
  const aiDesc = typeof ctx.meta?.ai_description === 'string' ? ctx.meta.ai_description : null
  const lines = [
    `${emoji} <b>${escapeHtml(TYPE_LABELS[ctx.type] ?? ctx.type)}</b>`,
    `📹 ${escapeHtml(ctx.cameraName)}`,
    ctx.zoneName ? `📍 ${escapeHtml(ctx.zoneName)}` : null,
    `🕐 ${tsLocal}`,
    aiDesc ? `\n${escapeHtml(aiDesc)}` : null,
  ].filter((l): l is string => l !== null)
  return lines.join('\n')
}

async function sendWebhook(url: string, ctx: EventCtx): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: ctx.type,
      type_label: TYPE_LABELS[ctx.type] ?? ctx.type,
      severity: ctx.severity,
      camera: ctx.cameraName,
      zone: ctx.zoneName,
      ts: ctx.tsStart.toISOString(),
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`webhook ${url}: HTTP ${res.status}`)
}

// token from /admin/settings wins; env is the fallback
const tgToken = async (): Promise<string> =>
  (await settingSecret('telegram_bot_token')) || config.TELEGRAM_BOT_TOKEN

async function tgJson(token: string, method: string, body: unknown): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as { ok: boolean; description?: string }
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description ?? res.status}`)
}

async function sendTelegram(chatId: string | number, ctx: EventCtx): Promise<void> {
  const token = await tgToken()
  if (!token) throw new Error('telegram bot token not configured (settings/env)')
  const text = buildText(ctx)
  // «Принял» / «Ложное» right under the alert: the person who reads it is
  // rarely at a computer, and an event acknowledged in one tap is an event
  // that does not escalate and does not stay unhandled in the report.
  await tgJson(token, 'sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML',
    ...(ctx.eventId ? { reply_markup: ackButtons(ctx.eventId) } : {}),
  })

  if (ctx.snapshotKey) {
    const url = await minio.presignedGetObject(config.MINIO_BUCKET_SNAPSHOTS, ctx.snapshotKey, 300)
    const img = await fetch(url)
    if (!img.ok) return // message already sent; skip photo on fetch failure
    const bytes = Buffer.from(await img.arrayBuffer())
    const form = new FormData()
    form.append('chat_id', String(chatId))
    form.append('photo', new Blob([bytes], { type: 'image/jpeg' }), 'snapshot.jpg')
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form })
    const data = (await res.json()) as { ok: boolean; description?: string }
    if (!data.ok) throw new Error(`telegram sendPhoto: ${data.description ?? res.status}`)
  }
}

// «Отправить тестовое» from the admin page: synthetic message straight to the
// rule's channels — no event, no cooldown, no quiet hours (that's the point).
async function processTest(ruleId: string, tenantId: string): Promise<void> {
  const [rule] = await db.select().from(alertRule)
    .where(and(eq(alertRule.id, ruleId), eq(alertRule.tenantId, tenantId))).limit(1)
  if (!rule) { log('test: rule not found', { ruleId }); return }
  const channels = Channels.safeParse(rule.channels)
  if (!channels.success) { log('test: invalid channels', { ruleId }); return }

  const ctx: EventCtx = {
    type: rule.eventType, severity: 'info', tsStart: new Date(),
    cameraId: '', snapshotKey: null, cameraName: 'Тестовое уведомление',
    tz: 'Europe/Moscow', zoneName: null,
  }
  for (const ch of channels.data) {
    if (ch.type === 'telegram') {
      await sendTelegram((ch as z.infer<typeof TelegramChannel>).chat_id, ctx)
    } else if (ch.type === 'webhook') {
      await sendWebhook((ch as z.infer<typeof WebhookChannel>).url, ctx)
    }
  }
}

/** Periodic flush: one summary message per rule instead of an event stream.
 *  A rule flushes when its buffer is older than `alert_digest_minutes`. */
async function processDigest(redis: IORedis): Promise<void> {
  const minutes = await settingNumber('alert_digest_minutes')
  const ruleIds = await redis.smembers('digest:rules')
  for (const ruleId of ruleIds) {
    const lastRaw = await redis.get(`digest:last:${ruleId}`)
    if (lastRaw && Date.now() - Number(lastRaw) < minutes * 60_000) continue

    const rawEntries = await redis.lrange(`digest:${ruleId}`, 0, -1)
    if (rawEntries.length === 0) {
      await redis.srem('digest:rules', ruleId)
      continue
    }
    const [rule] = await db.select().from(alertRule).where(eq(alertRule.id, ruleId)).limit(1)
    if (!rule || !rule.enabled) {
      await redis.del(`digest:${ruleId}`)
      await redis.srem('digest:rules', ruleId)
      continue
    }

    const entries: DigestEntry[] = []
    for (const raw of rawEntries) {
      try { entries.push(JSON.parse(raw) as DigestEntry) } catch { /* skip */ }
    }
    const tz = entries[0]?.tz ?? 'Europe/Moscow'
    // hold the digest through quiet hours; it goes out in the morning
    if (inQuietHours(rule.schedule, tz, new Date())) continue

    await redis.del(`digest:${ruleId}`)
    await redis.set(`digest:last:${ruleId}`, String(Date.now()))

    // group by type+zone, count events and distinct people
    const groups = new Map<string, { count: number; people: Set<string> }>()
    for (const e of entries) {
      const label = `${TYPE_LABELS[e.type] ?? e.type}${e.zone ? ` — ${e.zone}` : ''}`
      const g = groups.get(label) ?? { count: 0, people: new Set<string>() }
      g.count++
      if (e.gid) g.people.add(e.gid)
      groups.set(label, g)
    }
    const lines = [`📊 <b>Сводка за ${minutes} мин</b>`]
    for (const [label, g] of groups) {
      const people = g.people.size > 0 ? `, людей: ${g.people.size}` : ''
      lines.push(`• ${escapeHtml(label)}: ${g.count}${people}`)
    }
    const text = lines.join('\n')

    const channels = Channels.safeParse(rule.channels)
    if (!channels.success) continue
    for (const ch of channels.data) {
      try {
        if (ch.type === 'telegram') {
          const token = await tgToken()
          if (!token) throw new Error('telegram bot token not configured')
          await tgJson(token, 'sendMessage', {
            chat_id: (ch as z.infer<typeof TelegramChannel>).chat_id,
            text, parse_mode: 'HTML',
          })
        } else if (ch.type === 'webhook') {
          const res = await fetch((ch as z.infer<typeof WebhookChannel>).url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ digest: true, minutes, entries }),
            signal: AbortSignal.timeout(10_000),
          })
          if (!res.ok) throw new Error(`webhook HTTP ${res.status}`)
        }
      } catch (err) {
        log('digest dispatch failed', {
          ruleId, channel: ch.type,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    log('digest sent', { ruleId, events: entries.length })
  }
}

/** Nobody pressed «Принял» on a critical event — tell the manager.
 *
 *  Deliberately ignores quiet hours: an unhandled critical event is exactly
 *  the case quiet hours must not swallow. It is also why the escalation
 *  message carries the same buttons — the manager can close it in one tap.
 *
 *  The mark lives in event.meta rather than Redis so it survives a flush and
 *  is visible in the journal: escalation must never fire twice for one event.
 */
async function processEscalation(): Promise<void> {
  const defaultMinutes = await settingNumber('escalation_minutes')

  // Recipients live on the tenant, so escalation is resolved per organisation.
  // A server-wide chat id would post one organisation's unhandled events into
  // another's chat the moment a second tenant exists.
  for (const t of await allTenantSettings()) {
    const chatId = t.settings.escalation_chat_id
    const minutes = t.settings.escalation_minutes && t.settings.escalation_minutes > 0
      ? t.settings.escalation_minutes
      : defaultMinutes
    if (!chatId || minutes <= 0) continue
    // nothing is escalated while the site is still being tuned
    if (inLearningMode(t.settings)) continue
    await escalateTenant(t.id, chatId, minutes)
  }
}

async function escalateTenant(
  tenantId: string, chatId: string, minutes: number,
): Promise<void> {
  const now = Date.now()
  const due = new Date(now - minutes * 60_000)
  // Older than this is history, not an emergency: after a long outage nobody
  // wants yesterday's backlog paged out all at once.
  const floor = new Date(now - ESCALATION_LOOKBACK_HOURS * 3_600_000)

  const rows = await db.select({
    id: event.id, type: event.type, tsStart: event.tsStart,
    cameraName: camera.name, zoneName: zone.name, tz: site.timezone,
  }).from(event)
    .innerJoin(camera, eq(event.cameraId, camera.id))
    .innerJoin(site, eq(event.siteId, site.id))
    .leftJoin(zone, eq(event.zoneId, zone.id))
    .where(and(
      eq(event.tenantId, tenantId),
      eq(event.severity, 'critical'),
      eq(event.resolved, false),
      eq(event.falsePositive, false),
      lt(event.tsStart, due),
      gte(event.tsStart, floor),
      sql`${event.meta} ->> 'escalated_at' IS NULL`,
    ))
    .orderBy(event.tsStart)
    .limit(20)

  for (const row of rows) {
    // Claim first: a send that throws must not leave the event eligible for
    // an escalation storm on the next tick.
    await db.update(event)
      .set({ meta: sql`${event.meta} || jsonb_build_object('escalated_at', to_jsonb(now()))` })
      .where(and(eq(event.id, row.id), eq(event.tsStart, row.tsStart)))

    const tsLocal = new Intl.DateTimeFormat('ru-RU', {
      timeZone: row.tz, dateStyle: 'short', timeStyle: 'short',
    }).format(row.tsStart)
    const waited = Math.round((now - row.tsStart.getTime()) / 60_000)
    const text = [
      `⏰ <b>Не разобрано ${waited} мин</b>`,
      `${escapeHtml(TYPE_LABELS[row.type] ?? row.type)}`,
      `📹 ${escapeHtml(row.cameraName)}`,
      row.zoneName ? `📍 ${escapeHtml(row.zoneName)}` : null,
      `🕐 ${tsLocal}`,
    ].filter((l): l is string => l !== null).join('\n')

    try {
      const token = await tgToken()
      if (!token) throw new Error('telegram bot token not configured')
      await tgJson(token, 'sendMessage', {
        chat_id: chatId, text, parse_mode: 'HTML', reply_markup: ackButtons(row.id),
      })
      log('escalated', { eventId: row.id, waited })
    } catch (err) {
      log('escalation failed', {
        eventId: row.id, error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/** Evening report + pre-shift camera check, if the organisation scheduled them. */
async function processSummaries(redis: IORedis): Promise<void> {
  await runScheduledSummaries({
    redis,
    send: async (chatId, text) => {
      const token = await tgToken()
      if (!token) throw new Error('telegram bot token not configured')
      await tgJson(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' })
    },
    log,
  })
}

async function processAlert(job: Job<AlertJob>, redis: IORedis): Promise<void> {
  const { event_id, tenant_id, test_rule_id, digest, escalate, summaries } = job.data
  if (digest) { await processDigest(redis); return }
  if (escalate) { await processEscalation(); return }
  if (summaries) { await processSummaries(redis); return }
  if (test_rule_id) { await processTest(test_rule_id, tenant_id); return }

  const [row] = await db.select({
    type: event.type, severity: event.severity, tsStart: event.tsStart,
    cameraId: event.cameraId, snapshotKey: event.snapshotKey,
    cameraName: camera.name, tz: site.timezone, zoneName: zone.name,
    meta: event.meta,
  }).from(event)
    .innerJoin(camera, eq(event.cameraId, camera.id))
    .innerJoin(site, eq(event.siteId, site.id))
    .leftJoin(zone, eq(event.zoneId, zone.id))
    .where(and(eq(event.id, event_id), eq(event.tenantId, tenant_id)))
    .limit(1)
  if (!row) { log('alert: event not found', { event_id }); return }

  // Learning mode: the site was installed days ago, nothing is tuned yet, and
  // sending the resulting flood is how a customer ends up switching alerts off
  // for good. Events are still recorded — the tuning is done from them.
  // Infrastructure events are exempt: during the first week «камера не в сети»
  // is exactly what the installer needs to hear.
  if (!INFRA_EVENT_TYPES.has(row.type)) {
    const ts = await getTenantSettings(tenant_id)
    if (inLearningMode(ts)) {
      log('alert suppressed: learning mode', { event_id, until: ts.learning_until })
      return
    }
  }

  const ctx: EventCtx = { ...row, eventId: event_id }

  const rules = await db.select().from(alertRule).where(and(
    eq(alertRule.tenantId, tenant_id),
    eq(alertRule.eventType, row.type), // row keeps the enum literal type
    eq(alertRule.enabled, true),
  ))

  // cross-camera person identity: the same visitor on 4 cameras is ONE subject
  const gid = typeof ctx.meta?.global_id === 'string' ? ctx.meta.global_id : null

  for (const rule of rules) {
    // conditions.min_severity: skip events below the rule's threshold
    const minSev = typeof rule.conditions.min_severity === 'string'
      ? rule.conditions.min_severity : 'info'
    if ((SEVERITY_RANK[ctx.severity] ?? 0) < (SEVERITY_RANK[minSev] ?? 0)) continue

    // schedule.quiet_from/quiet_to: silence the rule during quiet hours (site tz)
    if (inQuietHours(rule.schedule, ctx.tz, ctx.tsStart)) continue

    // cooldown per (rule, person) — camera is only the fallback subject,
    // so a person flickering between cameras can't re-trigger the rule
    const key = `cooldown:${rule.id}:${gid ?? ctx.cameraId}`
    const ok = await redis.set(key, '1', 'EX', Math.max(1, rule.cooldownSeconds), 'NX')
    if (ok !== 'OK') continue

    // non-critical events accumulate into a periodic digest instead of
    // spamming a message each — critical ones still go out instantly
    if (ctx.severity !== 'critical') {
      const entry: DigestEntry = {
        type: ctx.type, zone: ctx.zoneName, camera: ctx.cameraName,
        gid, tz: ctx.tz, ts: ctx.tsStart.toISOString(),
      }
      await redis.rpush(`digest:${rule.id}`, JSON.stringify(entry))
      await redis.sadd('digest:rules', rule.id)
      continue
    }

    const channels = Channels.safeParse(rule.channels)
    if (!channels.success) {
      log('alert: invalid channels', { ruleId: rule.id })
      continue
    }

    for (const ch of channels.data) {
      let status: 'sent' | 'failed' = 'sent'
      let error: string | null = null
      try {
        if (ch.type === 'telegram') {
          await sendTelegram((ch as z.infer<typeof TelegramChannel>).chat_id, ctx)
        } else if (ch.type === 'webhook') {
          await sendWebhook((ch as z.infer<typeof WebhookChannel>).url, ctx)
        } else {
          throw new Error(`unsupported channel: ${ch.type}`)
        }
      } catch (err) {
        status = 'failed'
        error = err instanceof Error ? err.message : String(err)
        log('alert dispatch failed', { ruleId: rule.id, channel: ch.type, error })
      }
      await db.insert(notification).values({
        eventId: event_id,
        ruleId: rule.id,
        channel: ch.type.slice(0, 32),
        status,
        error,
        sentAt: status === 'sent' ? new Date() : null,
      })
    }
  }
}

async function main(): Promise<void> {
  const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const cmd = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const worker = new Worker<AlertJob>(ALERTS_QUEUE, (job) => processAlert(job, cmd), {
    connection: connection as ConnectionOptions, concurrency: 5,
  })

  worker.on('failed', (job, err) => log('alert job failed', { id: job?.id, err: err.message }))

  // digest tick: every minute check which rule buffers are due to flush
  await alertsQueue.add('digest', { event_id: '', tenant_id: '', digest: true }, {
    repeat: { every: 60_000 }, jobId: 'digest-tick',
    removeOnComplete: 5, removeOnFail: 5,
  })

  // scheduled summaries tick: every 5 min is fine — each report is claimed
  // for its local day, so the tick only has to be finer than the schedule
  await alertsQueue.add('summaries', { event_id: '', tenant_id: '', summaries: true }, {
    repeat: { every: 300_000 }, jobId: 'summaries-tick',
    removeOnComplete: 5, removeOnFail: 5,
  })

  // escalation tick: critical events nobody acknowledged
  await alertsQueue.add('escalate', { event_id: '', tenant_id: '', escalate: true }, {
    repeat: { every: 60_000 }, jobId: 'escalate-tick',
    removeOnComplete: 5, removeOnFail: 5,
  })

  // «Принял» / «Ложное» pressed in Telegram. Detached on purpose: it owns a
  // long-lived polling loop and must not block worker startup or shutdown.
  void runTelegramAckPoller({ redis: cmd, token: tgToken, log })

  const shutdown = async (): Promise<void> => {
    await worker.close()
    await Promise.allSettled([connection.quit(), cmd.quit()])
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  log('alerts worker started')
}

void main()
